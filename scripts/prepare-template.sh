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
    echo "Updating template-dev.yaml with ImageTag: $IMAGE_TAG"
    sed -i.bak "s|ImageTag: v.*|ImageTag: $IMAGE_TAG|" cloudformation/template-dev.yaml
    rm -f cloudformation/template-dev.yaml.bak

elif [ "$MODE" = "stage" ]; then
    # Stage mode: create versioned templates and update them
    echo "Creating versioned templates..."
    
    # Copy template-dev.yaml to versioned template
    cp cloudformation/template-dev.yaml "cloudformation/template-${VERSION_TAG}.yaml"
    
    # Copy dashboard template-dev.yaml to versioned dashboard template
    cp cloudformation/dashboard/template-dev.yaml "cloudformation/dashboard/template-${VERSION_TAG}.yaml"
    
    # Update dashboard reference in versioned template
    sed -i.bak "s|dashboard/template-dev.yaml|dashboard/template-${VERSION_TAG}.yaml|" "cloudformation/template-${VERSION_TAG}.yaml"
    rm -f "cloudformation/template-${VERSION_TAG}.yaml.bak"
    
    # Update ImageTag in versioned template (replace any version tag, with or without SHA)
    echo "Updating template-${VERSION_TAG}.yaml with ImageTag: $IMAGE_TAG"
    sed -i.bak "s|ImageTag: v.*|ImageTag: $IMAGE_TAG|" "cloudformation/template-${VERSION_TAG}.yaml"
    rm -f "cloudformation/template-${VERSION_TAG}.yaml.bak"
    
    # Copy versioned template to template.yaml and update its ImageTag
    cp "cloudformation/template-${VERSION_TAG}.yaml" cloudformation/template.yaml
    echo "Updating template.yaml with ImageTag: $IMAGE_TAG"
    sed -i.bak "s|ImageTag: v.*|ImageTag: $IMAGE_TAG|" cloudformation/template.yaml
    rm -f cloudformation/template.yaml.bak

else
    echo "Error: Invalid mode '$MODE'. Must be 'dev' or 'stage'"
    exit 1
fi

echo "Template preparation complete"

