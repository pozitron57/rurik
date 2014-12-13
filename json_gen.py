#!/usr/bin/env python3


import json, re


# Destination object
tree = {}

# List of references to all subtrees that contains current guy
subtrees = [None]*100

# Read source file
with open("source.data") as fp:
    for line in fp:
        # Skip empty and commented lines
        if len(line) <= 1 or line[0] == "#":
            continue

        # Count number of tabs
        m = re.match(r'^(\s*)(.+)', line)
        tabs = len(m.group(1)) // 4

        # Get name from line:
        name = m.group(2)
        if name == 'invisible':
            name = ''

        # Person info
        guy = {
            'name' : name,
        }

        # Tree root
        if tabs == 0:
            tree = guy
            subtrees[0] = tree
            continue

        # Add guy to parent's subtree        
        if 'children' in subtrees[tabs-1]:
            subtrees[tabs-1]['children'].append(guy)
        else:
            subtrees[tabs-1]['children'] = [guy]

        # Set current guy as subtree
        subtrees[tabs] = subtrees[tabs-1]['children'][-1]

# Serialize tree object as JSON
with open('tree.json', 'w') as fp:
    json.dump(
        tree,
        fp,
        sort_keys = False, 
        indent = None,
        ensure_ascii = False
    )
