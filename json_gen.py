#!/usr/bin/env python3
# coding=utf-8

"""Turn source.data into tree.json, which is what the page loads.

source.data is one person per line, indented four spaces per generation.
Indentation alone describes the tree: a line is a child of the nearest line
above it that is indented one generation less.

    name | birth | death | standalone

Either date may be left empty, and a person with neither carries no columns
at all:

    Владимир Красное Солнышко | ок. 960 г. | 1015 г.
        Изяслав Владимирович | | 1001 г.
        Всеволод Владимирович

The optional fourth field, `standalone`, keeps a person in that position
without a parent line or ancestry highlight through the enclosing branch.

Lines starting with `#` are ignored, which is how the disputed branches at the
foot of the file are kept without being drawn.

A person named `invisible` is a spacer left from the D3 drawing this page
replaced, where blank rows were used to push branches apart. The name is
blanked here, and the page drops any spacer with no children of its own. The
first line of the file is one such spacer, and it is the root everybody hangs
from — the reason Вещий Олег and Рюрик can stand side by side without either
being the other's parent.

Edit source.data, run this, commit both.
"""

import json

SOURCE = 'source.data'
DEST = 'tree.json'
INDENT = 4                 # spaces per generation
SPACER = 'invisible'       # a row standing in for nobody


def parse(path):
    root = None
    # The last person seen at each depth. A line at depth d is a child of
    # whoever currently sits at depth d - 1.
    latest_at_depth = {}

    with open(path, encoding='utf-8') as source:
        for number, line in enumerate(source, 1):
            if not line.strip() or line.lstrip().startswith('#'):
                continue

            depth = (len(line) - len(line.lstrip(' '))) // INDENT
            fields = [field.strip() for field in line.split('|')]
            name, birth, death = (fields + ['', ''])[:3]

            person = {
                'name': '' if name == SPACER else name,
                'birth': birth,
                'death': death,
            }
            if len(fields) > 3 and fields[3] == 'standalone':
                person['standalone'] = True

            if depth == 0:
                root = person
            elif depth - 1 in latest_at_depth:
                latest_at_depth[depth - 1].setdefault('children', []).append(person)
            else:
                raise SystemExit(
                    '%s:%d: indented %d generations deep with nobody above to '
                    'belong to:\n    %s' % (path, number, depth, line.strip()))

            # Anyone deeper than this line belonged to whoever used to be here.
            latest_at_depth[depth] = person

    if root is None:
        raise SystemExit('%s: no unindented line to start the tree from' % path)
    return root


if __name__ == '__main__':
    with open(DEST, 'w', encoding='utf-8') as dest:
        json.dump(parse(SOURCE), dest, sort_keys=True, indent=None, ensure_ascii=False)
