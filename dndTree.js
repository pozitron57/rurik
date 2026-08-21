// Get JSON data
treeJSON = d3.json("tree.json", function(error, treeData) {

    // Calculate total nodes, max label length
    var totalNodes = 0;
    var maxLabelLength = 10;
    // variables for drag/drop
    var selectedNode = null;
    var draggingNode = null;
    // panning variables
    var panSpeed = 200;
    var panBoundary = 20; // Within 20px from edges will pan when dragging.
    // Misc. variables
    var i = 0;
    var duration = 757;
    var root;
    var numberOfGenerations = 2;
    var maxNuberOfGenerations = 20;
    var numberOfGenerationsOnStartup = 5;

    var buttonShowEveryone = d3.select("#show-all").append("button")
    // this text means "Show everebody"
        .text("Показать всех")
        .on('click', function (data, index) {
            expandAll(root);
            update(root);
        });

    var buttonHideEveryone = d3.select("#hide-all").append("button")
    // this text means "Hide everebody"
        .text("Спрятать всех")
        .on('click', function (data, index) {
            root.children.forEach(collapse);
            update(root);
            liscenterNode(root);
    });

    $("select").change(function () {
        numberOfGenerations = $("select").val();
    });

    var formNumberOfGenerations = d3.select("#dropdown-list").append("select");
    for (var i = 1; i <= maxNuberOfGenerations; i++) {
        var option = formNumberOfGenerations.append("option")
            .attr("value", i)
            .text(i);
        if ( i == numberOfGenerations ) {
            option.attr("selected", "selected");
        }
    }
    $("select").change(function () {
        numberOfGenerations = $("select").val();
    });
    var textNumberOfGenerations = d3.select("#open-gen-text").append("text")
    // this text means "Choose how much gererations to be expanded on click"
        .text("Раскрывать поколений по щелчку:");

    // size of the diagram
    var viewerWidth = $(document).width() - 8; //lisakov minus 50 to avoid scroll bars
    var viewerHeight = $(document).height() - 16;

    var tree = d3.layout.tree()
        .size([viewerHeight, viewerWidth]);

    // define a d3 diagonal projection for use by the node paths later on.
    var diagonal = d3.svg.diagonal()
        .projection(function(d) {
            return [d.y, d.x];
        });

    // A recursive helper function for performing some setup by walking through all nodes

    function visit(parent, visitFn, childrenFn) {
        if (!parent) return;

        visitFn(parent);

        var children = childrenFn(parent);
        if (children) {
            var count = children.length;
            for (var i = 0; i < count; i++) {
                visit(children[i], visitFn, childrenFn);
            }
        }
    }

    // Call visit function to establish maxLabelLength
    visit(treeData, function(d) {
        totalNodes++;
        maxLabelLength = Math.max(d.name.length, maxLabelLength);
        // Remember each child's position among its siblings, so that a list
        // split into shown/hidden parts can always be merged back in order.
        if (d.children) {
            d.children.forEach(function(c, n) { c.ord = n; });
        }

    }, function(d) {
        return d.children && d.children.length > 0 ? d.children : null;
    });


    // Define the zoom function for the zoomable tree

    function zoom() {
        svgGroup.attr("transform", "translate(" + d3.event.translate + ")scale(" + d3.event.scale + ")");
    }


    // define the zoomListener which calls the zoom function on the "zoom" event constrained within the scaleExtents
    var zoomListener = d3.behavior.zoom()
        .scaleExtent([0.1, 3])
        .on("zoom", zoom);


    // define the baseSvg, attaching a class for styling and the zoomListener
    var baseSvg = d3.select("#tree-container").append("svg")
        .attr("width", viewerWidth)
        .attr("height", viewerHeight)
        .attr("class", "overlay")
        .call(zoomListener);

    // Define the drag listeners for drag/drop behaviour of nodes.
    dragListener = d3.behavior.drag()
        .on("dragstart", function(d) {
            if (d == root) {
                return;
            }
            dragStarted = true;
            nodes = tree.nodes(d);
            d3.event.sourceEvent.stopPropagation();
            // it's important that we suppress the mouseover event on the node being dragged. Otherwise it will absorb the mouseover event and the underlying node will not detect it d3.select(this).attr('pointer-events', 'none');
        })
        .on("drag", function(d) {
            if (d == root) {
                return;
            }
            if (dragStarted) {
                domNode = this;
                initiateDrag(d, domNode);
            }

            d.x0 += d3.event.dy;
            d.y0 += d3.event.dx;
            var node = d3.select(this);
            node.attr("transform", "translate(" + d.y0 + "," + d.x0 + ")");
            updateTempConnector();
        }).on("dragend", function(d) {
            if (d == root) {
                return;
            }
            domNode = this;
            if (selectedNode) {
                // now remove the element from the parent, and insert it into the new elements children
                var index = draggingNode.parent.children.indexOf(draggingNode);
                if (index > -1) {
                    draggingNode.parent.children.splice(index, 1);
                }
                if (typeof selectedNode.children !== 'undefined' || typeof selectedNode._children !== 'undefined') {
                    if (typeof selectedNode.children !== 'undefined') {
                        selectedNode.children.push(draggingNode);
                    } else {
                        selectedNode._children.push(draggingNode);
                    }
                } else {
                    selectedNode.children = [];
                    selectedNode.children.push(draggingNode);
                }
                // Make sure that the node being added to is expanded so user can see added node is correctly moved
                expand(selectedNode);
                sortTree();
                endDrag();
            } else {
                endDrag();
            }
        });

    // Helper functions for collapsing and expanding nodes.

    // Children can now be hidden one at a time, so a node may hold shown and
    // hidden children at once. Any time the two lists are joined back together
    // they are reordered by 'ord' to keep the original source.data order.
    function mergeKids(a, b) {
        return (a || []).concat(b || []).sort(function(p, q) { return p.ord - q.ord; });
    }

    // True when only part of a node's offspring is on screen.
    function isPartial(d) {
        return !!(d.children && d.children.length && d._children && d._children.length);
    }

    // Tuck a childless node away into its parent. Returns the parent, or null
    // when there is nowhere to tuck it: an invisible parent (only the root)
    // would show no marker, leaving no way to click the node back into view.
    function hideInParent(d) {
        var p = d.parent;
        if (!p || !p.children || parseFloat(p.radius) < 0.1) return null;
        // A long press on a touch screen can be followed by a native
        // contextmenu event for the same node, so hiding must be idempotent.
        if (p.children.indexOf(d) === -1) return null;
        p.children = p.children.filter(function(c) { return c !== d; });
        p._children = mergeKids(p._children, [d]);
        if (p.children.length === 0) p.children = null;
        return p;
    }

    // Right-click, or a long press on a touch screen, hides a node inside its
    // parent. It works on any node: one with children takes its whole subtree
    // along, untouched for as long as it stays hidden. Bringing it back is a
    // click on the parent, which runs the usual "expand N generations" pass,
    // so a node that was collapsed when hidden does come back expanded.
    var longPressDelay = 600;
    var longPressTimer = null;
    var longPressAt = 0;

    function hide_handler(d) {
        var p = hideInParent(d);
        if (!p) return;
        update(p);
        liscenterNode(p);
    }

    function hide_on_right_click(d) {
        d3.event.preventDefault();
        hide_handler(d);
    }

    function long_press_cancel() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    function long_press_start(d) {
        long_press_cancel();
        longPressTimer = setTimeout(function() {
            longPressTimer = null;
            // The browser still sends a click on touchend; remember when the
            // press fired so that click does not expand what was just hidden.
            longPressAt = Date.now();
            hide_handler(d);
        }, longPressDelay);
    }

    function collapse(d) {
        if (d.children) {
            d._children = mergeKids(d.children, d._children);
            d._children.forEach(collapse);
            d.children = null;
        }
    }

    function expand(d) {
        if (d._children) {
            d.children = mergeKids(d.children, d._children);
            d._children = null;
            d.children.forEach(expand);
        }
    }

    function expandAll(d) {
        if (d.children) {
            d.children.forEach(expandAll);
        }
        expand(d);
    }

    var overCircle = function(d) {
        selectedNode = d;
        updateTempConnector();
    };
    var outCircle = function(d) {
        selectedNode = null;
        updateTempConnector();
    };

    // Function to update the temporary connector indicating dragging affiliation
    var updateTempConnector = function() {
        var data = [];
        if (draggingNode !== null && selectedNode !== null) {
            // have to flip the source coordinates since we did this for the existing connectors on the original tree
            data = [{
                source: {
                    x: selectedNode.y0,
                    y: selectedNode.x0
                },
                target: {
                    x: draggingNode.y0,
                    y: draggingNode.x0
                }
            }];
        }
        var link = svgGroup.selectAll(".templink").data(data);

        link.enter().append("path")
            .attr("class", "templink")
            .attr("d", d3.svg.diagonal())
            .attr('pointer-events', 'none');

        link.attr("d", d3.svg.diagonal());

        link.exit().remove();
    };

    // Function to center node when clicked/dropped so node doesn't get lost when collapsing/moving with large amount of children.

    function centerNode(source) {
        scale = zoomListener.scale();
        x = -source.y0;
        y = -source.x0;
        x = x * scale + viewerWidth / 2; // lisakov do not change horizontal position
        y = y * scale + viewerHeight / 2;
        d3.select('g').transition()
            .duration(duration)
            .attr("transform", "translate(" + x + "," + y + ")scale(" + scale + ")");
        zoomListener.scale(scale);
        zoomListener.translate([x, y]);
    }

    // Toggle children on click.
    //hombit-driven awesome function to expand choosen amount of generations

    function click(d) {
        if (d3.event.defaultPrevented) return; // click suppressed
        if (Date.now() - longPressAt < 1000) return; // already hidden by a long press
    click_handler(d);
    }

    function click_handler(d) {
        if (d._children) {
            var nodes = [d];
            for (var i = 0; i < numberOfGenerations; i++ ) {
                if (nodes.length == 0) {break;};
                var new_nodes = [];
                nodes.forEach(function(x) {
                    if (x.children) {
                        x.children.forEach( function(y) {
                            new_nodes.push(y);
                        } );
                    } else {
                        x.children = [];
                    }
                    if (x._children) {
                        x._children.forEach( function(y) {
                            new_nodes.push(y);
                        } );
                        // Merge rather than append: siblings may have been
                        // hidden one at a time, so order has to be restored.
                        x.children = mergeKids(x.children, x._children);
                        x._children = null;
                    }
                });
                nodes = new_nodes;
            }
        }
        else if (d.children) {
            d._children = d.children;
            d.children = null;
        }
        update(d);
        liscenterNode(d);
    return nodes;
    }

    function update(source) {
        // Compute the new height, function counts total children of root node and sets tree height accordingly.
        // This prevents the layout looking squashed when new nodes are made visible or looking sparse when nodes are removed
        // This makes the layout more consistent.
        var levelWidth = [1];
        var childCount = function(level, n) {

            if (n.children && n.children.length > 0) {
                if (levelWidth.length <= level + 1) levelWidth.push(0);

                levelWidth[level + 1] += n.children.length;
                n.children.forEach(function(d) {
                    childCount(level + 1, d);
                });
            }
        };
        childCount(0, root);
        var newHeight = d3.max(levelWidth) * 36; // lisakov set vertical distance px per line.
        tree = tree.size([newHeight, viewerWidth]);

        // Compute the new tree layout.
        var nodes = tree.nodes(root).reverse(),
            links = tree.links(nodes);

        // Set widths between levels based on maxLabelLength.
        nodes.forEach(function(d) {
            //d.y = (d.depth * (maxLabelLength * 5)); //maxLabelLength * 10px
            // alternatively to keep a fixed scale one can set a fixed depth per level
            // Normalize for fixed-depth by commenting out below line
             d.y = (d.depth * 237); //px per level.
        });

        // Update the nodes…
        node = svgGroup.selectAll("g.node")
            .data(nodes, function(d) {
                return d.id || (d.id = ++i);
            });


        // Enter any new nodes at the parent's previous position.
        var nodeEnter = node.enter().append("g")
            .call(dragListener)
            .attr("class", "node")
            .attr("transform", function(d) {
                return "translate(" + source.y0 + "," + source.x0 + ")";
            })
            .on('click', click)
            .on('contextmenu', hide_on_right_click)
            .on('touchstart', long_press_start)
            .on('touchmove', long_press_cancel)
            .on('touchend', long_press_cancel)
            .on('touchcancel', long_press_cancel);

//lisakov modified for getting colors from json
        nodeEnter.append("circle")
            //.attr("r", function(d) { return d.radius; })
            //.style("stroke", function(d) { return d.granica; })
            //.style("fill", function(d) { return d.zapolnenie; });

        // Marks a node whose offspring is only partly shown.
        nodeEnter.append("path")
            .attr("class", "partial-mark");

        nodeEnter.append("title")
            .text( function(d) {
                if ( d.birth == "" ){
                    d.birth = "?"
                }
                if ( d.death == "" ){
                    d.death = "?"
                }
                return "Годы жизни: " + d.birth + " – " + d.death;
            } )

        nodeEnter.append("text")

            //.attr("x", function(d) {     //lisakov probably it is an odd function. This -10 and 10 doesn't do anything
                //return d.children || d._children ?
                //(d.radius + 4) * -1 : d.radius + 4 })  //lisakov this line for name placement regarding his circle's radius
                //return d.children || d._children ? -10 : 10; })  //lisakov probably it is odd line

            .attr("dy", "-.05em")
            //.attr('class', 'nodeText')
            //.style("stroke", function(d) { return d.granica; })
            .style("fill", function(d) { return d.text_color; })
            .attr("text-anchor", function(d) {
                return d.children || d._children ? "end" : "start";
            })
            .text(function(d) { return d.name; })
            .style("fill-opacity", 0);

        // Update the text to reflect whether node has children or not.
        node.select('text')
            .attr("x", function(d) { return d.children || d._children ? -10 : -10; })
            .attr("text-anchor", function(d) { return d.children || d._children ? "end" : "end"; }) //lisakov place all guys to the left of the circle
            .text(function(d) { return d.name; });

        // Change the circle fill depending on whether it has children and is collapsed
    // lisakov trying to get color from json
        node.select("circle")
            .attr("r", function(d) { return d.radius; })
            //.attr("stroke-width", 6)
            .style("stroke", function(d) { return d.granica; })
            .style("fill", function(d) {
                return d._children ? "#FFC576" : "white";});

        // Draw a plus inside the circle when some children are shown and some
        // are hidden, so the node reads as "there is more underneath me".
        // Sized off the node's own radius, which keeps invisible nodes invisible.
        node.select("path.partial-mark")
            .style("display", function(d) { return isPartial(d) ? null : "none"; })
            .style("stroke-width", function(d) { return d.radius * 0.28; })
            .attr("d", function(d) {
                if (!isPartial(d)) return null;
                var a = d.radius * 0.55;
                return "M" + (-a) + ",0H" + a + "M0," + (-a) + "V" + a;
            });

        // Transition nodes to their new position.
        var nodeUpdate = node.transition()
            .duration(duration)
            .attr("transform", function(d) {
                return "translate(" + d.y + "," + d.x + ")";
            });

        // Fade the text in
        nodeUpdate.select("text")
            .style("fill-opacity", 1);

        // Transition exiting nodes to the parent's new position.
        var nodeExit = node.exit().transition()
            .duration(duration)
            .attr("transform", function(d) {
                return "translate(" + source.y + "," + source.x + ")";
            })
            .remove();

        nodeExit.select("circle")
            .attr("r", 0);

        nodeExit.select("text")
            .style("fill-opacity", 0);

        // Update the links…
        var link = svgGroup.selectAll("path.link")
            .data(links, function(d) {
                return d.target.id;
            });

        // Enter any new links at the parent's previous position.
        // lisakov modified to take colors fron json

        link.enter().insert("path", "g")
            .attr("class", "link")
            .style("stroke", function(d) { return d.target.line_color; })
            .style("stroke-width", function(d) { return d.target.line_width; })
            .attr("d", function(d) {
                var o = {
                    x: source.x0,
                    y: source.y0
                };
                return diagonal({
                    source: o,
                    target: o
                });
            });

        // Transition links to their new position.
        link.transition()
            .duration(duration)
            .attr("d", diagonal);

        // Transition exiting nodes to the parent's new position.
        link.exit().transition()
            .duration(duration)
            .attr("d", function(d) {
                var o = {
                    x: source.x,
                    y: source.y
                };
                return diagonal({
                    source: o,
                    target: o
                });
            })
            .remove();

        // Stash the old positions for transition.
        nodes.forEach(function(d) {
            d.x0 = d.x;
            d.y0 = d.y;
        });
    }

    // Append a group which holds all nodes and which the zoom Listener can act upon.
    var svgGroup = baseSvg.append("g");

    // Define the root
    root = treeData;
    root.x0 = viewerHeight / 2;
    root.y0 = 0;

    // Layout the tree initially and center on the root node.
    //update(root);
    //centerNode(root);

    // lisakov positioning node after click
    function liscenterNode(source) {
        scale = zoomListener.scale();
        x = -source.y0;
        y = -source.x0;
        x = x * scale + viewerWidth / 2.77; // lisakov put first node to left part of screen, not to the center (divide by 25 or smth like this if everything is expanded, or set 3.13 and 2.5 for rurik to be in center with invisible root and Veshiy Oleg).
        y = y * scale + viewerHeight / 2.500;
        d3.select('g').transition()
            .duration(duration)
            .attr("transform", "translate(" + x + "," + y + ")scale(" + scale + ")");
        zoomListener.scale(scale);
        zoomListener.translate([x, y]);
    }

    root.children.forEach(collapse);
    //liscenterNode(root);
    update(root);

    root.children.forEach( function(d) {
        if ( d._children ){
             var numberOfGenerationsOrig = numberOfGenerations;
             numberOfGenerations = numberOfGenerationsOnStartup;
         click_handler(d);
             numberOfGenerations = numberOfGenerationsOrig;
        }
    } );
});
