import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_location_marker/flutter_map_location_marker.dart';
import 'package:flutter_map_marker_cluster/flutter_map_marker_cluster.dart';
import 'package:latlong2/latlong.dart';
import 'package:toilet_map_2/detail_screen.dart';
import 'package:toilet_map_2/model/osm_data.dart';
import 'package:url_launcher/url_launcher.dart';

import 'model/loo.dart';
import 'model/response_data.dart';
import 'util/logging.dart' as logging;
import 'util/map_util.dart';

Widget searchHomePage(
  OsmData searchLocation,
  BuildContext context,
  bool showMap,
  //MapController mapController,
  List<Loo> theList,
) {
  if (showMap) {
    return makeMap(theList, searchLocation, context, true);
  } else {
    return makeList(theList, searchLocation, context, true);
  }
}

Widget homePage(
  OsmData userLocation,
  BuildContext context,
  bool showMap,
  //MapController? mapController,
  bool isFound,
) {
  return Stack(
    // Center is a layout widget. It takes a single child and positions it
    // in the middle of the parent.
    children: [
      FutureBuilder<ResponseData>(
        future: MapUtil.instance.fetchToilets(userLocation),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.done &&
              snapshot.hasData) {
            logging.log.info("Toilets fetched successfully");
            var nearbyToilets = snapshot.data!.data.loosByProximity
                .toList()
                .where((loo) => loo.hasRequiredFeature())
                .toList();
            nearbyToilets.sort(
              (l1, l2) => l1
                  .getDistance(userLocation.location)
                  .compareTo(l2.getDistance(userLocation.location)),
            );
            logging.log.info("Found ${nearbyToilets.length} toilets nearby");
            if (showMap) {
              logging.log.info("Showing map");
              return makeMap(
                nearbyToilets,
                userLocation,
                context,
                //mapController,
                isFound,
              );
            } else {
              logging.log.info("Not showing map");
              return makeList(nearbyToilets, userLocation, context, isFound);
            }
          } else if (snapshot.hasError) {
            //userLocation = LocationService().lastLocation;
            logging.log.severe("Error fetching toilets: ${snapshot.error}");
            return Text('Error: ${snapshot.error}');
          } else {
            return SizedBox(
              height: MediaQuery.of(context).size.height / 1.3,
              child: Center(child: CircularProgressIndicator()),
            );
          }
        },
      ),
      // This trailing comma makes auto-formatting nicer for build methods.
    ],
  );
}

Widget makeMap(
  List<Loo> loos,
  OsmData userLocation,
  BuildContext context,
  //MapController? mapController,
  bool isFound,
) {
  MapOptions options;
  List<Marker> markers = [];
  logging.log.info("Making map with ${loos.length} toilets");
  if (loos.isEmpty) {
    options = MapOptions(
      interactionOptions: const InteractionOptions(
        enableMultiFingerGestureRace: true,
        flags:
            InteractiveFlag.pinchZoom |
            InteractiveFlag.doubleTapZoom |
            InteractiveFlag.drag,
      ),
      //initialCenter: userLocation!.toLatLng(),
      initialZoom: 9.2,
      initialCenter: userLocation.location,
      onMapReady: () {
        logging.log.info("Map ready at ${userLocation.location}");
        // Use `MapController` as needed
        //mapController?.move(userLocation.location, 9.2);
      },
    );
  } else {
    List<LatLng> points = [];
    //points.clear();
    //_markers.clear();
    for (Loo loo in loos) {
      LatLng point = loo.location.toLatLng();
      points.add(point);
      markers.add(
        Marker(
          point: point,
          child: Tooltip(
            message: loo.getName(),
            child: InkWell(
              child: const Icon(Icons.location_on, size: 40),
              //SvgPicture.string(svgString),
              onTap: () {
                logging.log.info("Tapped on ${loo.getName()}");
                // SnackBar snackBar = SnackBar(
                //   content: Text(loo.getName()),
                //   action: SnackBarAction(
                //     label: 'Close',
                //     onPressed: () {
                //       // Some code to undo the change.
                //     },
                //   ),
                // );
                // ScaffoldMessenger.of(context).showSnackBar(snackBar);
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => DetailScreen(
                      loo: loo,
                      foundLocation: ((isFound) ? userLocation : null),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      );
    }
    if (points.length == 1) {
      logging.log.info("adding last location to points");
      points.add(userLocation.location);
    } else {
      logging.log.info("more than one point in points");
    }
    LatLngBounds bounds = LatLngBounds.fromPoints(points);
    // mapController?.fitCamera(
    //   CameraFit.bounds(bounds: bounds, padding: EdgeInsets.all(40)),
    // );
    logging.log.info("Map bounds are $bounds");
    //LatLng center = bounds.center;
    options = MapOptions(
      initialCenter: userLocation.location,
      interactionOptions: const InteractionOptions(
        enableMultiFingerGestureRace: true,
        flags:
            InteractiveFlag.pinchZoom |
            InteractiveFlag.doubleTapZoom |
            InteractiveFlag.drag,
      ),
      //initialZoom: 9.2, //initialCenter: center,
      // Error when only one location
      initialCameraFit: CameraFit.bounds(
        bounds: bounds,
        padding: EdgeInsets.all(40),
      ),
      onMapEvent: (event) {
        logging.log.info("Map event: $event");
      },
      onMapReady: () {
        // Use `MapController` as needed
        // if (bounds.longitudeWidth < 0.01) {
        //   bounds = LatLngBounds(
        //     LatLng(bounds.south, bounds.west - 0.01),
        //     LatLng(bounds.north, bounds.east + 0.01),
        //   );
        // }

        // mapController?.fitCamera(
        //   CameraFit.bounds(bounds: bounds, padding: EdgeInsets.all(40)),
        // );

        //setState(() {
        logging.log.info("On Map ready at ${userLocation.location}");
        //});
      },
    );
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
    children.add(makeClusterLayer(markers));
  }
  logging.log.info("Map made with ${children.length} layers");
  logging.log.info("Map options are ${options.toString()}");

  return //Positioned.fill(
  //child:
  FlutterMap(
    //mapController: mapController,
    options: options,
    children: children,
    //),
  );
}

MarkerClusterLayerWidget makeClusterLayer(List<Marker> allMarkers) {
  logging.log.info("Making cluster layer with ${allMarkers.length} markers");
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
      markers: allMarkers,
      polygonOptions: const PolygonOptions(
        borderColor: Colors.blueAccent,
        color: Colors.black12,
        borderStrokeWidth: 3,
      ),
      builder: (context, markers) {
        logging.log.info(
          "Cluster builder called with ${markers.length} markers",
        );
        return Container(
          decoration: BoxDecoration(
            border: Border.all(color: Color(0xFFED3D63), width: 4),
            borderRadius: BorderRadius.circular(20),
            color: Colors.white,
          ),
          child: Center(
            child: Text(
              markers.length.toString(),
              style: const TextStyle(color: Color(0xFF0A165A)),
            ),
          ),
        );
      },
    ),
  );
}

Widget makeList(
  List<Loo> nearbyToilets,
  OsmData userLocation,
  BuildContext context,
  bool isFound,
) {
  return Column(
    children: [
      Expanded(
        child: ListView.builder(
          itemCount: nearbyToilets.length,
          itemBuilder: (context, index) {
            Loo loo = nearbyToilets[index];
            //log.info(loo.getName());
            return Card(
              child: InkWell(
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => DetailScreen(
                        loo: loo,
                        foundLocation: ((isFound) ? userLocation : null),
                      ),
                    ),
                  );
                },
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ListTile(
                      title: Text(
                        "${loo.getName()} (${loo.getDistance(userLocation.location)}m)",//\n${loo.getFeatures()}",
                        style: Theme.of(context).textTheme.titleMedium),
                        textColor: Theme.of(context).colorScheme.primary,
                      ),

                      // subtitle: Text(
                      //   loo.getFeatures(),
                      //   style: Theme.of(context).textTheme.bodySmall,
                      // ),
                    loo.featuresToRichText(context),
                    SizedBox(height: 10),
                  ],
                ),
              ),
            );
            /*
            return Card(
              child: ListTile(
                title: Text(
                  "${loo.getName()} (${loo.getDistance(userLocation.location)}m)\n${loo.getFeatures()}",
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => DetailScreen(
                        loo: loo,
                        foundLocation: ((isFound) ? userLocation : null),
                      ),
                    ),
                  );
                },
              ),
            );
            */
          },
        ),
      ),
    ],
  );
}
