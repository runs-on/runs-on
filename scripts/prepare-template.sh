#!/bin/bash
set -euo pipefail

if [ $# -lt 3 ]; then
    echo "Usage: $0 <mode> <image_reference> <version_tag>"
    echo "  mode: 'dev' or 'stage'"
    echo "  image_reference: Docker image reference (e.g., registry:tag)"
    echo "  version_tag: Version tag to use (e.g., v2.10.0)"
    exit 1
fi

MODE=$1
IMAGE_REF=$2
VERSION_TAG=$3

# Capture SHA digest of the image
echo "Capturing Docker image SHA digest for $IMAGE_REF..."
DIGEST=$(docker buildx imagetools inspect "$IMAGE_REF" --format '{{json .}}' 2>/dev/null | jq -r '.manifest.digest // empty' || docker manifest inspect "$IMAGE_REF" 2>/dev/null | jq -r '.config.digest // empty' || echo "")

if [ -z "$DIGEST" ]; then
    echo "Warning: Could not retrieve image digest, using version tag only"
    IMAGE_TAG="$VERSION_TAG"
else
    echo "Found digest: $DIGEST"
    IMAGE_TAG="${VERSION_TAG}@${DIGEST}"
fi

if [ "$MODE" = "dev" ]; then
    # Dev mode: update template-dev.yaml
    echo "Updating template-dev.yaml with AppTag: $VERSION_TAG and ImageTag: $IMAGE_TAG"
    # Update AppTag (match any value - v.* or dev, but skip lines with !FindInMap)
    sed -i.bak "/!FindInMap/!s|AppTag: .*|AppTag: $VERSION_TAG|" cloudformation/template-dev.yaml
    # Update ImageTag (match any value - v.* or dev, with or without SHA, but skip lines with !FindInMap)
    sed -i.bak "/!FindInMap/!s|ImageTag: .*|ImageTag: $IMAGE_TAG|" cloudformation/template-dev.yaml
    rm -f cloudformation/template-dev.yaml.bak

elif [ "$MODE" = "stage" ]; then
    # Stage mode: create template.yaml from template-dev.yaml
    echo "Creating template.yaml from template-dev.yaml..."
    
    # Copy template-dev.yaml to template.yaml
    cp cloudformation/template-dev.yaml cloudformation/template.yaml
    
    # Copy dashboard template-dev.yaml to dashboard/template.yaml (will be renamed to template-$(VERSION_TAG).yaml on release)
    cp cloudformation/dashboard/template-dev.yaml cloudformation/dashboard/template.yaml
    
    # Update dashboard reference in template.yaml
    sed -i.bak "s|dashboard/template-dev.yaml|dashboard/template-$VERSION_TAG.yaml|" cloudformation/template.yaml
    rm -f cloudformation/template.yaml.bak
    
    # Update AppTag and ImageTag in template.yaml (skip lines with !FindInMap)
    echo "Updating template.yaml with AppTag: $VERSION_TAG and ImageTag: $IMAGE_TAG"
    sed -i.bak "/!FindInMap/!s|AppTag: .*|AppTag: $VERSION_TAG|" cloudformation/template.yaml
    sed -i.bak "/!FindInMap/!s|ImageTag: .*|ImageTag: $IMAGE_TAG|" cloudformation/template.yaml
    rm -f cloudformation/template.yaml.bak
else
    echo "Error: Invalid mode '$MODE'. Must be 'dev' or 'stage'"
    exit 1
fi

echo "Template preparation complete"

