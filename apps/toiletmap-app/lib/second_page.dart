import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_location_marker/flutter_map_location_marker.dart';
import 'package:flutter_map_marker_cluster/flutter_map_marker_cluster.dart';
import 'package:flutter_svg/svg.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import 'detail_screen.dart';
import 'model/loo.dart';
import 'model/osm_data.dart';
import 'model/response_data.dart';
import 'model/user_agent_client.dart';
import 'util/database_util.dart';
import 'util/logging.dart' as logging;
import 'util/map_util.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({required Key key, required this.title}) : super(key: key);

  final String title;

  @override
  State<SearchScreen> createState() => _SearchScreen();
}

class _SearchScreen extends State<SearchScreen> {
  late List<Loo> loos;
  OsmData? userLocation;
  OsmData? searchLocation;
  String? locationLoos;
  MapController? mapController;
  // final PopupController _popupController = PopupController();
  List<LatLng> points = [];
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounce;
  late List<OsmData> _options = <OsmData>[];
  late MarkerClusterLayerWidget _markerClusterLayerWidget;

  List<Marker> _markers = [];

  @override
  void initState() {
    super.initState();
    mapController = MapController();
    logging.log.info("SearchScreen initState");
    loos = [];
    points = [];
  }

  @override
  Widget build(BuildContext context) {
    // we need to watch for updates to the user's location
    // the user needs to move 500 meters before we update the list
    userLocation = Provider.of<OsmData>(context);
    logging.log.info("User location in search screen is $userLocation");

    LatLngBounds? bounds;
    if (loos.isNotEmpty) {
      makeMarkers(loos);
      logging.log.info("Making bounds for ${loos.length} toilets");
      bounds = LatLngBounds.fromPoints(points);
    }
    logging.log.info("MapScreen build");
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
        //title: const Text('Map Screen'),
        title: svg,
        actions: <Widget>[
          TextButton(
            child: Column(children: [Icon(Icons.save), Text("Save")]),
            //icon: const Icon(Icons.save),
            onPressed: () {
              if (searchLocation == null) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('No location selected to save')),
                );
                return;
              }
              logging.log.info("Saving location");
              // Save the toilets to the database or perform any other action
              // For now, just log the action
              ToiletDatabase().instance
                  .addLocation(searchLocation!, loos: locationLoos)
                  .then((value) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            'Location saved to phone: ${searchLocation?.formattedAddress}',
                          ),
                        ),
                      );
                    }
                    logging.log.info("Location saved as $value");
                    _searchController.clear();
                  })
                  .catchError((error) {
                    logging.log.severe("Error saving location: $error");
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Error saving location: $error'),
                        ),
                      );
                    }
                  });

              logging.log.info("Location saved: ${searchLocation?.toString()}");
            },
          ),
        ],
      ),
      body: Stack(
        children: <Widget>[
          makeMap(bounds),
          SafeArea(child: Stack(children: <Widget>[makeSearchBox()])),
          //SafeArea(
          //    child: Stack(children: <Widget>[const _AsyncAutocomplete()])),
        ],
      ),
    );
  }

  Widget makeSearchBox() {
    //var service = Services();
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.only(
            left: 8.0,
            top: 10.0,
            right: 8.0,
            bottom: 0.0,
          ),
          child: TextFormField(
            controller: _searchController,
            cursorColor: Colors.black,
            style: TextStyle(
              color: Colors.black,
              backgroundColor: Colors.white,
            ),
            decoration: InputDecoration(
              labelText: 'Search for location',
              labelStyle: TextStyle(
                color: Theme.of(context).colorScheme.primary,
                backgroundColor: Theme.of(context).colorScheme.onPrimary,
              ),
              filled: true,
              fillColor: Theme.of(context).colorScheme.onPrimary,
              border: const OutlineInputBorder(
                borderRadius: BorderRadius.all(Radius.circular(10.0)),
                borderSide: BorderSide(color: Colors.black, width: 1.0),
              ),
              focusedBorder: const OutlineInputBorder(
                borderRadius: BorderRadius.all(Radius.circular(10.0)),
                borderSide: BorderSide(color: Colors.black, width: 1.0),
              ),
            ),
            onChanged: (String value) {
              if (_debounce?.isActive ?? false) {
                _debounce?.cancel();
                logging.log.info("Cancel debounce");
              }
              //setState(() {});
              _debounce = Timer(const Duration(milliseconds: 500), () async {
                var client = UserAgentClient(
                  // 'Great British Public Toilet Map Mobile App', http.Client());
                  MapUtil.instance.getAppName(),
                  http.Client(),
                );
                try {
                  logging.log.info("Search for $value");
                  String url = MapUtil.instance.getSearchUrl(value);
                  //'https://nominatim.openstreetmap.org/search?q=$value&format=json&addressdetails=1&countrycodes=gb&limit=5&email=a.j.beaumont@aston.ac.uk';
                  logging.log.info("Search for $url");
                  http.Response response = await client.get(Uri.parse(url));

                  var decodedResponse =
                      jsonDecode(utf8.decode(response.bodyBytes))
                          as List<dynamic>;
                  logging.log.info("decoded response $decodedResponse");
                  _options = decodedResponse
                      .map(
                        (e) => OsmData.withDisplayName(
                          displayName: e['display_name'],
                          location: LatLng(
                            double.parse(e['lat']),
                            double.parse(e['lon']),
                          ),
                        ),
                      )
                      .toList();
                  if (_options.isEmpty) {
                    logging.log.info("No results found for $value");
                    // fix the warning about context...
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('No results found for "$value"'),
                        ),
                      );
                    }
                  } else {
                    logging.log.info("Found ${_options.length} results");
                  }
                  if (mounted) {
                    setState(() {
                      _options = _options;
                    });
                  }

                  //Flexible(child: _buildListView());
                } on Exception catch (e) {
                  logging.log.severe("something wrong $e");
                } finally {
                  client.close();
                }
              });
            },
          ),
        ),
        Flexible(child: _buildListView()),
      ],
    );
  }

  Widget _buildListView() {
    return ListView.builder(
      shrinkWrap: true,
      // physics: const NeverScrollableScrollPhysics(),
      itemCount: _options.length > 5 ? 5 : _options.length,
      itemBuilder: (context, index) {
        logging.log.info(
          "Building list view for ${_options[index].displayName}",
        );
        if (_options.isEmpty) {
          return const SizedBox.shrink();
        }
        return Card(
          child: ListTile(
            tileColor: Theme.of(context).colorScheme.onPrimary,
            leading: Icon(Icons.location_on, color: Colors.cyan),
            title: Text(
              _options[index].displayName,
              style: TextStyle(
                color: Theme.of(context).colorScheme.primary,
                backgroundColor: Theme.of(context).colorScheme.onPrimary,
              ),
            ),
            onTap: () async {
              List<Loo> foundLoos = [];
              LatLng center = LatLng(
                _options[index].location.latitude,
                _options[index].location.longitude,
              );
              logging.log.info("moving map to $center");
              mapController?.move(center, 11);
              logging.log.info(_options[index].displayName);
              OsmData osmData = _options[index];

              searchLocation = await ToiletDatabase().instance
                  .fetchLocationByAddress(osmData.displayName);
              if (searchLocation == null) {
                logging.log.info("No location found in DB, creating new one");
                searchLocation = OsmData.withDisplayName(
                  id: 0, // Temporary ID, will be set by DB
                  location: LatLng(
                    osmData.location.latitude,
                    osmData.location.longitude,
                  ),
                  displayName: osmData.displayName,
                );
              } else {
                logging.log.info(
                  "Found location in DB: ${searchLocation?.formattedAddress}",
                );
              }

              _options.clear();
              //setState(() {});
              () async {
                logging.log.info("Fetching toilets for ${osmData.displayName}");
                ResponseData response = await MapUtil.instance.fetchToilets(
                  searchLocation!,
                );
                foundLoos = response.data.loosByProximity
                    .where((loo) => loo.hasRequiredFeature())
                    .toList();

                logging.log.info("Found ${foundLoos.length} toilets");
                locationLoos = jsonEncode(response.data);
                /* Navigator.pushReplacement(
                context,
                MaterialPageRoute(
                  builder: (context) => SearchScreen(foundLoos, loos: foundLoos),
                ),
              ); */

                setState(() {
                  loos.clear();
                  loos.addAll(foundLoos);
                  loos = loos;
                  makeMarkers(loos);
                  //mapController?.move(center, 11);
                });
                if (foundLoos.isEmpty && context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        'No toilets found near "${osmData.displayName}"',
                      ),
                    ),
                  );
                  _searchController.clear();
                }
              }();
            },
          ),
        );
      },
    );
  }

  Widget makeMap(LatLngBounds? bounds) {
    MapOptions options;
    logging.log.info("Making map with ${loos.length} toilets $bounds ");
    if (bounds == null || loos.isEmpty) {
      logging.log.info("null bounds or empty loos list");
      options = MapOptions(
        interactionOptions: const InteractionOptions(
          enableMultiFingerGestureRace: true,
          flags:
              InteractiveFlag.pinchZoom |
              InteractiveFlag.doubleTapZoom |
              InteractiveFlag.drag,
        ),
        initialCenter: userLocation!.location,
        initialZoom: 11,
      );
    } else {
      if (loos.length == 1) {
        logging.log.info("loos length is 1");
        options = MapOptions(
          interactionOptions: const InteractionOptions(
            enableMultiFingerGestureRace: true,
            flags:
                InteractiveFlag.pinchZoom |
                InteractiveFlag.doubleTapZoom |
                InteractiveFlag.drag,
          ),
          initialCenter: bounds.center,
        );
        //mapController?.move(bounds.center, 10);
      } else {
        logging.log.info("loos length is ${loos.length}");
        options = MapOptions(
          interactionOptions: const InteractionOptions(
            enableMultiFingerGestureRace: true,
            flags:
                InteractiveFlag.pinchZoom |
                InteractiveFlag.doubleTapZoom |
                InteractiveFlag.drag,
          ),
          initialCenter: bounds.center,
          // Error when only one location
          initialCameraFit: CameraFit.bounds(
            bounds: bounds,
            padding: EdgeInsets.all(20),
          ),
        );
        //LatLng loc = ((userLocation != null) ? userLocation!.toLatLng() : bounds.center);
        mapController?.fitCamera(
          CameraFit.bounds(bounds: bounds, padding: EdgeInsets.all(20)),
        );
        //Logging.log.info("Moved the map to ${bounds.center}");
      }
    }
    List<Widget> children = [
      MapUtil.instance.getTileLayer(),
      CurrentLocationLayer(),
      RichAttributionWidget(
        alignment: AttributionAlignment.bottomLeft,
        attributions: [
          TextSourceAttribution(
            'OpenStreetMap contributors',
            onTap: () =>
                launchUrl(Uri.parse('https://openstreetmap.org/copyright')),
          ),
          TextSourceAttribution(
            'Great British Toilet Map Data',
            onTap: () => launchUrl(Uri.parse('https://www.toiletmap.org.uk/')),
          ),
        ],
      ),
    ];
    if (loos.isNotEmpty) {
      _markerClusterLayerWidget = makeClusterLayer();
      children.add(_markerClusterLayerWidget);
    }
    /*
    children.add(MarkerLayer(
          markers: [
            Marker(
              point: searchLocation != null
                  ? LatLng(searchLocation!.location.latitude,
                      searchLocation!.location.longitude)
                  : userLocation!.location,
              child: const Icon(Icons.location_pin, size: 30, color: Color.fromRGBO(10, 22, 94, 0.7)),
            ),
          ],
        ));
        */
    return Positioned.fill(
      child: FlutterMap(
        mapController: mapController,
        options: options,
        children: children,
      ),
    );
  }

  void makeMarkers(List<Loo> loos) {
    this.loos = loos;

    setState(() {
      points.clear();
      //_markers.clear();
      for (Loo loo in loos) {
        LatLng point = LatLng(loo.location.lat, loo.location.lng);
        points.add(point);
      }
    });
    logging.log.info("Making markers for ${loos.length} toilets");
    List<Marker> newMarkers = [];
    for (Loo loo in loos) {
      LatLng point = LatLng(loo.location.lat, loo.location.lng);
      newMarkers.add(
        Marker(
          point: point,
          child: Tooltip(
            message: loo.getName(),
            child: InkWell(
              child: const Icon(
                Icons.location_on,
                color: Colors.red,
                size: 40,
              ), //SvgPicture.string(svgString),
              onTap: () => setState(() {
                logging.log.info("Tapped on ${loo.getName()}");
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) =>
                        DetailScreen(loo: loo, foundLocation: searchLocation),
                  ),
                );
              }),
            ),
          ),
        ),
      );
      points.add(point);
    }
    logging.log.info("markers made");
    setState(() {
      _markers = newMarkers;
      logging.log.info("Markers set to ${_markers.length}");
    });
  }

  MarkerClusterLayerWidget makeClusterLayer() {
    logging.log.info("Making cluster layer");

    return MarkerClusterLayerWidget(
      options: MarkerClusterLayerOptions(
        spiderfyCircleRadius: 80,
        spiderfySpiralDistanceMultiplier: 2,
        circleSpiralSwitchover: 12,
        maxClusterRadius: 120,
        rotate: true,
        size: const Size(40, 40),
        alignment: Alignment.center,
        padding: const EdgeInsets.all(50),
        maxZoom: 15,
        markers: _markers,
        polygonOptions: const PolygonOptions(
          borderColor: Colors.blueAccent,
          color: Colors.black12,
          borderStrokeWidth: 3,
        ),
        /*

        popupOptions: PopupOptions(
            popupSnap: PopupSnap.markerTop,
            popupController: _popupController,
            popupBuilder: (_, marker) => Container(
                  width: 200,
                  height: 100,
                  color: Colors.white,
                  child: GestureDetector(
                    onTap: () => logging.log.info('Popup tap!'),
                    child: const Text(
                      'Container popup for marker',
                    ),
                  ),
                )),
        */
        builder: (context, markers) {
          logging.log.info(
            "Cluster builder called with ${markers.length} markers",
          );
          return Container(
            decoration: BoxDecoration(
              border: Border.all(color: Colors.red, width: 4),
              borderRadius: BorderRadius.circular(20),
              color: Colors.white,
            ),
            child: Center(
              child: Text(
                markers.length.toString(),
                style: const TextStyle(color: Color.fromARGB(255, 0x0A, 0x16, 0x5E)),
              ),
            ),
          );
        },
      ),
    );
  }

  /* -------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
}
