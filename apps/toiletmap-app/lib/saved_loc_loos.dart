import 'package:flutter/material.dart';
import 'package:toilet_map_2/model/loos_by_proximity.dart';
import 'package:toilet_map_2/util/database_util.dart';
import 'package:toilet_map_2/util/map_util.dart';

import 'display_toilets.dart';
import 'model/loo.dart';
import 'model/osm_data.dart';
import 'settings_screen.dart';
import 'util/logging.dart' as logging;

class SavedLocLoos extends StatefulWidget {
  const SavedLocLoos({
    super.key,
    required this.title,
    required this.searchLocation,
    required this.locID,
  });

  // This widget is the home page of your application. It is stateful, meaning
  // that it has a State object (defined below) that contains fields that affect
  // how it looks.

  // This class is the configuration for the state. It holds the values (in this
  // case the title) provided by the parent (in this case the App widget) and
  // used by the build method of the State. Fields in a Widget subclass are
  // always marked "final".

  final String title;
  final OsmData searchLocation;

  final dynamic locID;

  @override
  State<SavedLocLoos> createState() => _SavedLocLoosState();
}

class _SavedLocLoosState extends State<SavedLocLoos> {
  var currentItem = 0;
  List<Loo> theList = [];
  //late MapController mapController;
  late bool showMap;

  @override
  void initState() {
    super.initState();
    //mapController = MapController();
    showMap = true;
  }

  @override
  Widget build(BuildContext context) {
    // we need to watch for updates to the user's location
    // the user needs to move 500 meters before we update the list
    logging.log.info(
      "User location: ${widget.searchLocation.location.latitude} ${widget.searchLocation.location.longitude}",
    );

    // This method is rerun every time setState is called.
    return Scaffold(
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
      appBar: AppBar(
        backgroundColor: Theme.of(context).colorScheme.onPrimary,
        foregroundColor: Theme.of(context)
            .colorScheme
            .primary, //backgroundColor: Theme.of(context).colorScheme.onPrimary,
        // Here we take the value from the MyHomePage object that was created by
        // the App.build method, and use it to set our AppBar title.
        title: Text(widget.title),
        /* title: SvgPicture.asset(
          'assets/images/logo.svg',
          semanticsLabel: 'Toilet Map Logo',
          height: 40,
          width: 40,
        ), */
        actions: <Widget>[
          TextButton(
            child: Column(children: [Icon(Icons.filter_list), Text("Filter")]),
            onPressed: () {
              logging.log.info("Opening filter");
              _navigateAndDisplaySelection(context);
              /*
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (context) => SettingScreen()),
                );
                */
            },
          ),
        ],
      ),
      body: Center(
        // Center is a layout widget. It takes a single child and positions it
        // in the middle of the parent.
        child: FutureBuilder<LoosByProximity?>(
          future: ToiletDatabase().instance.fetchLocationLoos(widget.locID),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.done &&
                snapshot.hasData) {
              theList.clear();

              theList.addAll(
                snapshot.data!.loosByProximity
                    .where((loo) => loo.hasRequiredFeature())
                    .where((loo) {
                      int distance = loo.getDistance(
                        widget.searchLocation.location,
                      );
                      // logging.log.info(
                      //   "distance to this loo is $distance returning ${distance < MapUtil.instance.getSearchRadius()}",
                      // );
                      return distance < MapUtil.instance.getSearchRadius();
                    })
                    .toList(),
              );
              theList.sort(
                (l1, l2) => l1
                    .getDistance(widget.searchLocation.location)
                    .compareTo(l2.getDistance(widget.searchLocation.location)),
              );

              /* if (theList.isNotEmpty) {
                setState(() {
                  theList = theList;
                });
              } */
              if (theList.isEmpty) {
                return const Center(
                  child: Text("No toilets found.  Try changing the filters."),
                );
              }
              /*
              return Column(
                children: [
                  Expanded(
                    child: ListView.builder(
                      itemCount: theList.length,
                      itemBuilder: (context, index) {
                        Loo loo = theList[index];
                        //log.info(loo.getName());
                        return Card(
                          child: ListTile(
                            title: Text(
                              "${loo.getName()} (${loo.getDistance(widget.searchLocation.location)}m)\n${loo.getFeatures()}",
                            ),
                            onTap: () {
                              logging.log.info(
                                "Tapped on loo: ${loo.getName()} with opening hours ${loo.getOpeningTimes()}",
                              );
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (context) => DetailScreen(
                                    loo: loo,
                                    foundLocation: widget.searchLocation,
                                  ),
                                ),
                              );
                            },
                          ),
                        );
                      },
                    ),
                  ),
                ],
              );
              */

              return searchHomePage(
                widget.searchLocation,
                context,
                showMap,
                /* mapController, */
                theList,
              );
            } else if (snapshot.hasError) {
              return Text('${snapshot.error}');
            }

            // By default, show a loading spinner.
            return SizedBox(
              height: MediaQuery.of(context).size.height / 1.3,
              child: Center(child: CircularProgressIndicator()),
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          setState(() {
            showMap = !showMap;
            if (showMap) {
              logging.log.info("Map enabled");
            } else {
              logging.log.info("Map disabled");
            }
          });
        },

        tooltip: (showMap) ? 'Show List' : 'Show Map',
        backgroundColor: Theme.of(context).colorScheme.onPrimary,
        foregroundColor: Theme.of(context).colorScheme.primary,
        child: ((showMap) ? Icon(Icons.view_list) : Icon(Icons.map)),
      ),
    );
  }

  // A method that launches the SelectionScreen and awaits the result from
  // Navigator.pop.
  Future<void> _navigateAndDisplaySelection(BuildContext context) async {
    // Navigator.push returns a Future that completes after calling
    // Navigator.pop on the Selection Screen.
    final result = await Navigator.push(
      context,
      MaterialPageRoute<String>(builder: (context) => const SettingScreen()),
    );

    // When a BuildContext is used from a StatefulWidget, the mounted property
    // must be checked after an asynchronous gap.
    if (!context.mounted) return;

    // After the Selection Screen returns a result, hide any previous snackbars
    // and show the new result.
    if ((result != null && result == 'true') ||
        MapUtil.instance.changedFilters == true) {
      MapUtil.instance.changedFilters = false;
      
      setState(() {
        theList = [];
        // no need to use filteredList because it is going to go back to the API
        //filteredList = List.where((loo) => loo.hasRequiredFeature()).toList();
      });
    }
  }
}
