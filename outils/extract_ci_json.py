#!/usr/bin/env python3
"""ready-data/CI.js -> ci.json (entrée de build_ci.py).
Usage : python3 extract_ci_json.py ready-data/CI.js ci.json"""
import json, sys
s = open(sys.argv[1], encoding='utf8').read()
json.dump(json.loads(s[s.index('= {') + 2:].rstrip().rstrip(';')), open(sys.argv[2], 'w'), ensure_ascii=False)
