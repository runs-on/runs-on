#!/bin/bash
set -euo pipefail

GITHUB_USERNAMES=""
REPO_FULL_NAME="runs-on/server" # Target GitHub repository

usage() {
  echo "Usage: $0 [-g \"user1,user2\"] [-e \"email1@example.com,email2@example.com\"]"
  echo "  -g GITHUB_USERNAMES: Comma-separated list of GitHub usernames to invite to ${REPO_FULL_NAME} with Read access."
  echo "  -h:                  Display this help message."
  echo ""
  echo "Prerequisites:"
  echo "  - gh CLI installed and authenticated (for GitHub operations)."
  exit 1
}

while getopts ":g:e:h" opt; do
  case ${opt} in
    g)
      GITHUB_USERNAMES="$OPTARG"
      ;;
    h)
      usage
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      usage
      ;;
    :)
      echo "Option -$OPTARG requires an argument." >&2
      usage
      ;;
  esac
done

# --- GitHub Operations ---
if [ -n "$GITHUB_USERNAMES" ]; then
  if ! command -v gh &> /dev/null; then
    echo "Error: gh CLI not found. Please install it first for GitHub operations." >&2
    exit 1
  fi
  echo "--- Inviting GitHub users to ${REPO_FULL_NAME} ---"
  IFS=',' read -ra USERS_ARRAY <<< "$GITHUB_USERNAMES"
  for user in "${USERS_ARRAY[@]}"; do
    trimmed_user=$(echo "$user" | xargs) # Trim whitespace
    if [ -n "$trimmed_user" ]; then
      echo "Inviting GitHub user: '$trimmed_user' with Read access to ${REPO_FULL_NAME}..."
      # The gh api command will exit with 0 on success (201 Created or 204 No Content if already a collaborator)
      # and non-zero on failure.
      if gh api \
          --method PUT \
          -H "Accept: application/vnd.github+json" \
          -H "X-GitHub-Api-Version: 2022-11-28" \
          "/repos/${REPO_FULL_NAME}/collaborators/${trimmed_user}" \
          -f permission='read' --silent; then
        echo "Successfully sent invitation to '$trimmed_user' or user is already a collaborator."
      else
        # gh CLI typically prints error messages to stderr on failure.
        echo "Failed to invite '$trimmed_user'. Check gh CLI output, user existence, or your permissions for ${REPO_FULL_NAME}." >&2
        # Consider if script should exit or continue. For now, it continues.
      fi
    fi
  done
  echo "--- GitHub invitations processing complete ---"
else
  echo "No GitHub usernames provided via -g. Skipping GitHub invitations."
fi