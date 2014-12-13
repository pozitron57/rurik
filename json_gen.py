#!/usr/bin/env python3


import json, re


tree = {}
subtrees = [None]*100
previous_tabs = 0

# Read source file
with open("source.data") as fh:
    for line in fh:
        # Skip empty and commented lines
        if len(line) <= 1 or line[0] == "#":
            continue

        # Count number of tabs
        m = re.match(r'^(\s*)(.+)', line)
        tabs = len(m.group(1)) // 4
        name = m.group(2)

        guy = {
            'name' : name,
        }

        # Tree root
        if tabs == 0:
            tree = guy
            subtrees[0] = tree
            continue

        if 'children' in subtrees[tabs-1]:
            subtrees[tabs-1]['children'].append(guy)
        else:
            subtrees[tabs-1]['children'] = [guy]
        subtrees[tabs] = subtrees[tabs-1]['children'][-1]

with open('tree.json', 'w') as fh:
    fh.write( json.dumps(tree, sort_keys=True, ensure_ascii=False) )
