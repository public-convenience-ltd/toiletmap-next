import 'package:flutter/material.dart';
import 'package:flutter_svg/svg.dart';
import 'package:provider/provider.dart';
import 'package:toilet_map_2/feedback_page.dart';
import 'package:toilet_map_2/location/location_service.dart';

import 'display_toilets.dart';
import 'model/loo.dart';
import 'model/osm_data.dart';
import 'settings_screen.dart';
import 'util/logging.dart' as logging;
import 'util/map_util.dart';

class FirstPage extends StatefulWidget {
  const FirstPage({required Key key, required this.title}) : super(key: key);

  final String title;

  @override
  State<FirstPage> createState() => _FirstPageState();
}

class _FirstPageState extends State<FirstPage> {
  late OsmData userLocation;
  //List<LatLng> points = [];
  //late MapController mapController;

  List<Loo> nearbyToilets = <Loo>[];

  //final List<Marker> _markers = <Marker>[];

  late bool showMap;

  @override
  void initState() {
    super.initState();
    //mapController = MapController();
    showMap = true;
  }

  @override
  Widget build(BuildContext context) {
    userLocation = Provider.of<OsmData>(context, listen: true);
    //userLocation = context.watch<OsmData>();
    logging.log.info("REBUILDING First Page User location is $userLocation");
    const String assetName = 'assets/logo.svg';
    final Widget svg = SvgPicture.asset(
      assetName,
      semanticsLabel: 'App Logo',
      height: 32,
      width: 32,
    );
    return Scaffold(
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
      appBar: AppBar(
        backgroundColor: Theme.of(context).colorScheme.onPrimary,
        foregroundColor: Theme.of(context).colorScheme.primary,
        title: svg,
        actions: <Widget>[
          TextButton(
            //backgroundColor: Theme.of(context).colorScheme.onPrimary,
            child: Column(children: [Icon(Icons.replay), Text("Reload")]),
            //icon: Icon(Icons.replay),
            onPressed: () {
              setState(() {
                nearbyToilets = <Loo>[];
                logging.log.info("Refresh pressed");
                //theList = [];
              });
            },
          ),
          TextButton(
            child: Column(children: [Icon(Icons.filter_list), Text("Filter")]),
            // icon: Icon(
            //   Icons.filter_list,
            //   color: Theme.of(context).colorScheme.primary,
            // ),
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
          TextButton(
            child: Column(children: [Icon(Icons.feedback_outlined), Text("Feedback")]),
            // icon: Icon(
            //   Icons.filter_list,
            //   color: Theme.of(context).colorScheme.primary,
            // ),
            onPressed: () async {
              logging.log.info("Opening Feedback Page");
              await Navigator.push(
                context,
                MaterialPageRoute<void>(
                  builder: (context) => const FeedbackPage(),
                ),
              );
            },
          ),
        ],
      ),
      body: FutureBuilder(
        future: LocationService.instance.locationPermissions(),
        builder: (BuildContext context, AsyncSnapshot<OsmData> snapshot) {
          if (snapshot.hasData) {
            userLocation = snapshot.data!;
            return homePage(
              userLocation,
              context,
              showMap,
              /*mapController,*/ false,
            );
          }
          // return Center(child: Text("We need location permissions to display nearby locations.\nWe do not collect any user data.\nPlease wait while the data loads"));
          return SizedBox(
            height: MediaQuery.of(context).size.height / 1.3,
            child: Center(child: CircularProgressIndicator()),
          );
        },
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
        nearbyToilets = <Loo>[];
        // no need to use filteredList because it is going to go back to the API
        //filteredList = List.where((loo) => loo.hasRequiredFeature()).toList();
      });
    }
  }
}
