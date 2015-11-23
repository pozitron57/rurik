The goal of the project is to create the complete family tree for the Rurik dynasty (Rurikids) who ruled the lands of Rus from 862 until 1598. Goal has been achieved (this family tree contains more than 750 people!) but there are lots of features to add.

*The animation is in Russian but it is translated on the actual web page [lisakov.com/en/tree](/en/tree/).*

[![Rurikids](/animation/tree.gif)](/en/tree/)


<!-- more -->

## Authors:

**[Konstantin Malanchev](http://homb.it):** lead programmer, a very good man;  
**[Sergey Lisakov](http://lisakov.com/en/me):** idea, design, data, dull coding, make a very good man work.

## Technical info:

See the project on [GitHub](https://github.com/pozitron57/rurik).

The [D3.js](http://d3js.org/) collapsible tree [template](http://bl.ocks.org/robschmuecker/7880033) is used.

The file `source.data` contains the list of the dynasty members. One tab (4 spaces) corresponds to the 1st generation, 2 tabs (8 spaces) to the 2nd generation, etc.

`json_gen.py` reads `source.data` file and produce `tree.json` which is used by `dndTree.js`.

## Implemented functions:

- «Show all» and «hide all» buttons
- Choose how many generations are showed by the click (1–20)
- Choose the number of displayed generations on the page load
- Pop-ups with the info about a person on mouse hover (β-version, currently it only shows the date of birth and death for first 5 generations).

## Functions to be implemented:

- Place the tree on the page load at certain coordinates
- Stylish pop-up windows on mouse hover
- List of all princes. Availability to select one or several princes from the list and to highlight it in the tree. Display as few as possible branches showing selected princes.
