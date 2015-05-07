#!/usr/bin/env python3
#coding=utf8

import json, re

# Destination object
tree = {}

# List of references to all subtrees that contains current guy
subtrees = [None]*100

# Read source file
with open("source.data") as fp:
    for line in fp:

        # Skip empty and commented lines
        v = re.match(r'^\s*#', line)
        if len(line) <= 1 or v:
            continue

        # Count number of tabs
        m = re.match(r'^(\s*)(.+)', line)
        tabs = len(m.group(1)) // 4

        ### Read parameters of a guy
        groups =  line.split('|')
        name            = '|'.join(groups[0:1]).strip()
        line_width      = '|'.join(groups[1:2]).strip()
        line_color      = '|'.join(groups[2:3]).strip() 
        radius          = '|'.join(groups[3:4]).strip()
        granica         = '|'.join(groups[4:5]).strip()
        birth           = '|'.join(groups[5:6]).strip()
        death           = '|'.join(groups[6:7]).strip()


        # set invisible parameters
        if name == 'invisible':
            name = ''
            granica = 'white'

        # Person info
        guy = {
            'name' : name,
            'radius' : radius,
            'line_color' : line_color,
            'line_width' : line_width,
            'granica' : granica,
            'birth' : birth,
            'death' : death
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
