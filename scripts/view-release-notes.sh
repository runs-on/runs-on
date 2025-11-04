echo "Prompt: Generate a nice email recap announcing the changes for the given release notes. RunsOn is maintained just by myself, so make sure to avoid "We" and say "I". Sign Cyril.

Release notes:
"

TAGS="$@"
for tag in $TAGS; do
  echo "Release notes for $tag:"
  gh release view "$tag" --json body --jq .body
  echo
done
