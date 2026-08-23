The goal of the project is to create the complete family tree for the Rurik dynasty (Rurikids) who ruled the lands of Rus from 862 until 1598. This family tree currently contains 1028 nodes.

*The animation is in Russian but it is translated on the actual web page [lisakov.com/en/projects/tree](https://lisakov.com/en/projects/tree/).*

[![Rurikids](https://lisakov.com/animation/tree.gif)](https://lisakov.com/en/projects/tree/)


## Authors:

**[Konstantin Malanchev](http://homb.it):** lead programmer, a very good man;  
**[Sergey Lisakov](https://lisakov.com/en/about):** idea, design, data, dull coding, make a very good man work.

## Technical info:

The page has no framework and no build step. `treeengine.js` is a
Reingold–Tilford/Buchheim tidy layout over the currently visible subtree, which
guarantees that labels can never collide; `tree.js` paints the result and drives
the camera; `treestyle.css` holds both palettes and every colour on the page.
A card carries classes for what it *is* — which column it sits in, whether it is
on the main line, what its mark has to say — and the stylesheet decides what
that looks like, which is why switching themes writes one attribute and rebuilds
nothing. It replaced a [D3.js](http://d3js.org/) collapsible tree
[template](http://bl.ocks.org/robschmuecker/7880033); the last commit that still
loaded it is `8b12a34^`, and `d3.js` and `dndTree.js` live there, in the history,
rather than in the working tree.

The only face the page downloads is JetBrains Mono, served from this domain —
nothing is requested from a third party. `jetbrainsmono-400.woff2` and
`jetbrainsmono-500.woff2` are cut from the upstream variable font with
[fonttools](https://github.com/fonttools/fonttools):

    fonttools varLib.instancer 'JetBrainsMono[wght].ttf' wght=400 -o static-400.ttf
    pyftsubset static-400.ttf --output-file=jetbrainsmono-400.woff2 --flavor=woff2 \
      --unicodes='U+0020-007E,U+00B7,U+0401,U+0410-044F,U+0451,U+2014,U+2212' \
      --layout-features='' --name-IDs='0,1,2,3,4,5,6,13,14' --name-legacy --name-languages='*'

That is Latin for the Roman numerals, the zoom readout and `SHIFT`, the Russian
alphabet for the labels, and the three marks the chrome prints — 164
codepoints, about 7 KB per weight. The picker's caret and tick are inline SVG,
so no glyph is carried for them. Repeat with `wght=500` for the second file. The names are
set in the browser's own sans, because no display face the design tried carries
Cyrillic. The font is licensed under the OFL, reproduced in `OFL.txt`.

The file `source.data` contains the list of the dynasty members. One tab (4 spaces) corresponds to the 1st generation, 2 tabs (8 spaces) to the 2nd generation, etc.

`json_gen.py` reads `source.data` file and produce `tree.json` which is used by `tree.js`.

## Implemented functions:

- «Collapse», «show everyone» and «fit» buttons
- Dark and light themes, remembered between visits
- A click opens one generation, alt/shift-click twenty, a double click the whole branch
- A right click (long press on a touch screen) hides a person inside the parent, which lights up to say where they went
- Opening a node lights up the children it just revealed, and the wires they hang from, in that same colour, and slides the camera sideways — never zooming — to bring it on screen; when the new generations are too wide to fit, the clicked one goes to the left edge
- A generation ruler in Roman numerals above the columns, thinned out as you zoom away
- The main dynastic line — Рюрик → … → Иван IV Грозный — stays lit at all times; hovering anyone else traces their own line back to Рюрик
- Pop-ups with the info about a person on mouse hover: years, generation, number of descendants

## Functions to be implemented:

- List of all princes. Availability to select one or several princes from the list and to highlight it in the tree. Display as few as possible branches showing selected princes.
