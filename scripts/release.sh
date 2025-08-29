#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting release process...${NC}"

# Check if working directory is clean
if [[ -n $(git status -s) ]]; then
  echo -e "${RED}Error: Working directory is not clean${NC}"
  echo "Please commit or stash your changes before releasing."
  exit 1
fi

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo -e "${YELLOW}Warning: You're not on the main branch (currently on: $CURRENT_BRANCH)${NC}"
  read -p "Continue anyway? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# Pull latest changes
echo -e "${GREEN}📥 Pulling latest changes...${NC}"
git pull origin main

# Run linting
echo -e "${GREEN}🔍 Running linting...${NC}"
npm run lint

# Run type checking
echo -e "${GREEN}🔧 Running type checking...${NC}"
npm run typecheck

# Run tests
echo -e "${GREEN}🧪 Running tests...${NC}"
npm run test:coverage

# Build project
echo -e "${GREEN}🔨 Building project...${NC}"
npm run build

# Check build output
if [[ ! -f "dist/index.js" ]]; then
  echo -e "${RED}Error: Build output not found${NC}"
  exit 1
fi

# Show current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}📋 Current version: ${CURRENT_VERSION}${NC}"

# Get new version
echo "Select version bump type:"
echo "1) patch (1.0.0 -> 1.0.1)"
echo "2) minor (1.0.0 -> 1.1.0)"
echo "3) major (1.0.0 -> 2.0.0)"
echo "4) custom version"
read -p "Enter choice (1-4): " -n 1 -r
echo

case $REPLY in
  1)
    VERSION_TYPE="patch"
    ;;
  2)
    VERSION_TYPE="minor"
    ;;
  3)
    VERSION_TYPE="major"
    ;;
  4)
    read -p "Enter custom version: " CUSTOM_VERSION
    VERSION_TYPE="$CUSTOM_VERSION"
    ;;
  *)
    echo "Invalid choice. Aborted."
    exit 1
    ;;
esac

# Update version
echo -e "${GREEN}📝 Updating version...${NC}"
if [[ "$VERSION_TYPE" == "patch" ]] || [[ "$VERSION_TYPE" == "minor" ]] || [[ "$VERSION_TYPE" == "major" ]]; then
  npm version $VERSION_TYPE
else
  npm version $VERSION_TYPE --no-git-tag-version
  git add package.json package-lock.json
  git commit -m "v$VERSION_TYPE"
  git tag "v$VERSION_TYPE"
fi

NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}✅ Version updated to: ${NEW_VERSION}${NC}"

# Confirm release
echo -e "${YELLOW}🤔 Ready to release version ${NEW_VERSION}?${NC}"
read -p "This will push to GitHub and trigger npm publish. Continue? (y/N): " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Release aborted. You can manually push when ready:"
  echo "  git push origin main --tags"
  exit 0
fi

# Push to git
echo -e "${GREEN}📤 Pushing to GitHub...${NC}"
git push origin main --tags

echo -e "${GREEN}🎉 Release complete!${NC}"
echo -e "${GREEN}GitHub Actions will automatically publish to npm when the tag is pushed.${NC}"
echo -e "${GREEN}Monitor the progress at: https://github.com/carlrannaberg/cc-acp/actions${NC}"