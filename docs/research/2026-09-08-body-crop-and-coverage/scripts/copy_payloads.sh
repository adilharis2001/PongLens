#!/bin/zsh
# After EXPORT DONE: the nine rebuilt body-card payloads, the manifest and Wayne's
# full-frame skeletons into the deploy worktree.
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
SRC=$S/v3deploy/public/research; DST=$S/bodyfix/public/research
for m in 10322849 1c08539e 2eab3e3d 5c90151a 5fd822ec 77fc4dee 95a07786 cebaa6d4 f3237587; do
  d=$(ls -d $SRC/body-detector/$m-*/ | head -1); id=$(basename $d)
  mkdir -p $DST/body-detector/$id && cp $d/compare.json $DST/body-detector/$id/compare.json && echo "copied $id"
done
cp $SRC/body-detector/index.json $DST/body-detector/index.json
w=$(ls -d $DST/v3-serve-detector/95a07786-*/ | head -1)
[ -s $S/poseretest/comparepage_95a07786/pose.json ] && cp $S/poseretest/comparepage_95a07786/pose.json $w/pose.json && echo "Wayne pose.json -> $w"
cd $S/bodyfix && git status --short -- public/research | head -20
