#!/bin/zsh
# one page build: $1 = match; RF_ENV, RF_OUT, RF_LOG, RF_LAB from the environment (macOS xargs -I caps the command at 255 bytes)
m=$1
cd $RF_LAB || exit 1
env V3_MATCH=$m V3_BODYFIRST=confirm ${=RF_ENV} CMP_OUT=${RF_OUT}$m /usr/bin/python3 build_compare_page.py > ${RF_OUT}$m.log 2>&1 || echo "FAIL $m ${RF_OUT}" >> $RF_LOG
