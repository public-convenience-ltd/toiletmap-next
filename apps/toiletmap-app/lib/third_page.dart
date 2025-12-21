// display a list of saved locations from the ToiletMap database
import 'package:flutter/material.dart';
import 'package:flutter_svg/svg.dart';

import 'model/osm_data.dart';
import 'saved_loc_loos.dart';
import 'util/database_util.dart';
import 'util/logging.dart' as logging;

class SavedLocationsScreen extends StatefulWidget {
  const SavedLocationsScreen({required Key key, required this.title})
    : super(key: key);

  // This widget is the home page of your application. It is stateful, meaning
  // that it has a State object (defined below) that contains fields that affect
  // how it looks.

  // This class is the configuration for the state. It holds the values (in this
  // case the title) provided by the parent (in this case the App widget) and
  // used by the build method of the State. Fields in a Widget subclass are
  // always marked "final".

  final String title;

  @override
  State<SavedLocationsScreen> createState() => _SavedLocationsScreenState();
}

class _SavedLocationsScreenState extends State<SavedLocationsScreen> {
  List<OsmData> theList = [];

  @override
  void initState() {
    super.initState();
    getSavedLocations();
  }

  @override
  Widget build(BuildContext context) {
    const String assetName = 'assets/logo.svg';
    final Widget svg = SvgPicture.asset(
      assetName,
      semanticsLabel: 'App Logo',
      height: 32,
      width: 32,
    );
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Theme.of(context).colorScheme.onPrimary,
        foregroundColor: Theme.of(context).colorScheme.primary,
        title: svg,
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              itemCount: theList.length,
              itemBuilder: (context, index) {
                OsmData loc = theList[index];
                return Card(
                  child: ListTile(
                    title: Text(loc.displayName),
                    trailing: IconButton(
                      icon: Icon(Icons.delete),
                      color: Theme.of(context).colorScheme.primary,
                      onPressed: () {
                        logging.log.info(
                          "Delete button pressed for location: ${loc.formattedAddress}",
                        );
                        showAlertDialog(context, loc, index);
                      },
                    ),
                    onTap: () {
                      logging.log.info(
                        "Tapped on location: ${loc.formattedAddress}",
                      );
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) => SavedLocLoos(
                            title: loc.displayName,
                            locID: loc.id,
                            searchLocation: loc,
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
      ),
    );
  }

  Future<void> getSavedLocations() async {
    ToiletDatabase().instance
        .locations()
        .then((value) {
          logging.log.info("Fetched ${value.length} locations from DB");
          // Do something with the fetched locations
          setState(() {
            theList = value;
          });
        })
        .catchError((error) {
          logging.log.severe("Error fetching locations: $error");
        });
    logging.log.info("Opening list view");
  }

  void showAlertDialog(BuildContext context, OsmData loc, int index) {
    // set up the buttons
    Widget cancelButton = TextButton(
      child: Text("Cancel"),
      onPressed: () {
        Navigator.pop(context);
      },
    );
    Widget continueButton = TextButton(
      child: Text("Delete"),
      onPressed: () {
        ToiletDatabase().instance
            .removeLocation(loc.id)
            .then((_) {
              logging.log.info("Deleted location: ${loc.formattedAddress}");
              setState(() {
                theList.removeAt(index);
              });
            })
            .catchError((error) {
              logging.log.severe("Error deleting location: $error");
            });
        Navigator.pop(context);
      },
    );
    // set up the AlertDialog
    AlertDialog alert = AlertDialog(
      title: Text("Deleting ${loc.displayName}"),
      content: Text("Please confirm the delete?"),
      actions: [cancelButton, continueButton],
    );
    // show the dialog
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return alert;
      },
    );
  }
}
