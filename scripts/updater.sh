#!/bin/sh
# Burrow's updater: lets whoever runs Burrow install updates from the admin page, without SSH.
# It runs in its own small container (see docker-compose.yml), with this folder at /repo, Burrow's
# data folder at /data and Docker's control socket. Every few seconds it writes what it knows to
# /data/updater/status.json; when the admin page asks (by creating /data/updater/request) it does
# what you'd do by hand: git pull, then rebuild and restart Burrow.
# With AUTO_UPDATE=releases in .env it also installs each new release by itself, a few minutes
# after it's published on GitHub (the "Start release" workflow publishes it once every app is ready).
set -u
DIR=/data/updater
mkdir -p "$DIR"
# Burrow runs as the image's "node" user (1000), and leaves its request in here.
chown 1000:1000 "$DIR"
cd /repo || exit 1
apk add --no-cache git >/dev/null 2>&1
git config --global --get-all safe.directory | grep -qx /repo || git config --global --add safe.directory /repo
# The name Docker Compose knows this install by, so the rebuild replaces the running Burrow.
PROJECT=$(docker inspect "$(hostname)" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null)
[ -n "$PROJECT" ] || PROJECT=burrow
OWNER=$(stat -c %u:%g /repo)

json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r\t'; }
AUTO=${AUTO_UPDATE:-}
result=${UPDATER_RESULT:-}
result_at=${UPDATER_RESULT_AT:-0}
updating=false
last_fetch=0

write_status() {
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  commit=$(git rev-parse --short HEAD 2>/dev/null)
  date=$(git log -1 --format=%ct 2>/dev/null)
  latest=$(git rev-parse --short "origin/$branch" 2>/dev/null)
  behind=$(git rev-list --count "HEAD..origin/$branch" 2>/dev/null || echo 0)
  changes=$(git log --format=%s "HEAD..origin/$branch" 2>/dev/null | head -20 | while read -r line; do printf '"%s",' "$(json "$line")"; done)
  cat > "$DIR/status.json.tmp" <<JSON
{"seenAt":$(date +%s),"branch":"$(json "$branch")","commit":"$commit","commitDate":${date:-0},"latest":"$latest","behind":${behind:-0},"changes":[${changes%,}],"checkedAt":$last_fetch,"updating":$updating,"result":"$result","resultAt":$result_at}
JSON
  mv "$DIR/status.json.tmp" "$DIR/status.json"
}

# The newest published release (vX.Y.Z tag) that's ahead of what's running, if any. A release that
# already failed to install isn't tried again until there's a newer one. Only tags that build on
# what's running count: a stray tag with a high number on an old commit (like v8.0.0, made by
# mistake for v0.8.2) would otherwise always look newest and hide every real release after it.
release_to_install() {
  [ "$AUTO" = releases ] || return 0
  for tag in $(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --no-merged HEAD --sort=-v:refname); do
    git merge-base --is-ancestor HEAD "$tag" 2>/dev/null || continue
    # And only tags on the branch this server follows (main), so a tag pushed onto a commit that
    # never went through a pull request is never installed by itself.
    git merge-base --is-ancestor "$tag" "origin/$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null || continue
    [ "$tag" != "$(cat "$DIR/auto-failed" 2>/dev/null)" ] && echo "$tag"
    return 0
  done
}

# git runs as root in here; hand what it wrote back to whoever owns the folder, so a `git pull`
# over SSH keeps working.
give_back() { chown -R "$OWNER" /repo/.git 2>/dev/null; }

# This script, as it was when the updater started, so an update that changes it restarts it.
SELF=$(md5sum scripts/updater.sh 2>/dev/null)

while true; do
  now=$(date +%s)
  every=3600
  [ "$AUTO" = releases ] && every=300
  if [ $((now - last_fetch)) -ge $every ] || [ -f "$DIR/request" ]; then
    # --prune-tags drops tags deleted on GitHub, which a plain fetch keeps forever.
    git fetch --quiet --tags --prune --prune-tags origin 2>"$DIR/fetch-error.txt" && last_fetch=$now
    give_back
  fi
  auto_tag=$(release_to_install)
  if [ -f "$DIR/request" ] || [ -n "$auto_tag" ]; then
    rm -f "$DIR/request"
    updating=true
    write_status
    if [ -n "$auto_tag" ]; then
      echo "Installing release $auto_tag at $(date)" > "$DIR/log.txt"
      step="git merge --ff-only $auto_tag"
    else
      echo "Updating at $(date)" > "$DIR/log.txt"
      step="git pull --ff-only"
    fi
    if $step >> "$DIR/log.txt" 2>&1 \
      && chown -R "$OWNER" /repo \
      && docker compose -p "$PROJECT" up -d --build burrow >> "$DIR/log.txt" 2>&1; then
      result=ok
    else
      result=failed
      [ -z "$auto_tag" ] || echo "$auto_tag" > "$DIR/auto-failed"
    fi
    chown -R "$OWNER" /repo 2>/dev/null
    result_at=$(date +%s)
    updating=false
    if [ "$result" = ok ] && [ "$(md5sum scripts/updater.sh 2>/dev/null)" != "$SELF" ]; then
      write_status
      UPDATER_RESULT=$result UPDATER_RESULT_AT=$result_at exec sh /repo/scripts/updater.sh
    fi
  fi
  write_status
  sleep 10
done
