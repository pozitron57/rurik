The aim of the project is to create the complete family tree for the Rurik dynasty (Rurikids) who ruled the lands of Rus from 862 until 1598. Full description of the project in Russian is available [here](http://lisakov.com/blog/2014/11/25/rurik-pedigree/).

You can see the live demo at [lisakov.com/tree](http://lisakov.com/tree/).

### Technical info:

The D3.js [collapsible tree template](http://bl.ocks.org/robschmuecker/7880033) is used.

The file ```source.data``` contains the list of the dynasty members. One tab (4 spaces) corresponds to the 1st generation, 2 tabs (8 spaces) to the 2nd generation, etc.

```json_gen.py``` reads ```source.data``` file and produce ```tree.json``` which is used by ```dndTree.js```.

### Implemented functions:
- «Show everebody» and «hide everebody» buttons;
- Choose how many generations are showed by the click (1–20);
- Choose the number of displayed generations on the page load;
- Popups with the info about a person on mouse hover (β-version, currently only birth and death date for 5 generations).

### Functions to be implemented:
- Beautifull pop-up windows on mouse hover, with styles, fonts, etc.;
- Place the tree on the page load at certain coordinates;
- List of all princes. Availability to select one or several princes from the list and to highlight it in the tree. Display as few as possible branches showing selected princes.




