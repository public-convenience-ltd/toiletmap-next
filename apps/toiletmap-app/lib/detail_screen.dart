import 'package:flutter/material.dart';
import 'package:flutter_map_location_marker/flutter_map_location_marker.dart';
import 'package:latlong2/latlong.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geocoding/geocoding.dart';
import 'package:provider/provider.dart';
import 'package:collection/collection.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:open_route_service/open_route_service.dart';

import 'env/env.dart';
import 'model/loo.dart';
import 'model/osm_data.dart';
import 'model/route_options.dart';
import 'route_options_dialog.dart';
import 'services/ors_service.dart';
import 'util/logging.dart' as logging;
import 'util/map_util.dart';
import 'util/navigation_launcher.dart';

class DetailScreen extends StatefulWidget {
  const DetailScreen({
    super.key,
    required this.loo,
    required this.foundLocation,
  });

  final Loo loo;
  final OsmData? foundLocation;

  @override
  State createState() => _DetailScreenState();
}

class _DetailScreenState extends State<DetailScreen> {
  // The loo we are showing details of
  late Loo loo;
  // Hmm, what?
  Placemark? placemark;
  bool placemarkFound = false;
  // When we have a route to loo from current location,
  //// this is the list of points
  List<LatLng>? routePoints;
  late double distance;
  // The user's location
  OsmData? userLocation;
  // The map controller
  MapController? mapController;
  List<String> days = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];

  RouteOptions _routeOptions = const RouteOptions(TransportMode.walking);

  _DetailScreenState() {
    mapController = MapController();
  }

  @override
  void initState() {
    super.initState();
    distance = 0;
    loo = widget.loo;
  }

  @override
  Widget build(BuildContext context) {
    // Use the Todo to create the UI.
    userLocation = Provider.of<OsmData>(context);
    if (routePoints != null && routePoints!.isNotEmpty && distance == 0) {
      double d = 0;
      for (var i = 1; i < routePoints!.length; i++) {
        d += Distance().as(
          LengthUnit.Meter,
          routePoints![i - 1],
          routePoints![i],
        );
      }
      //setState(() {
      logging.log.info("Calculated distance: $d m");
      distance = d;
      //});
    } else {
      // distance = Geolocator.distanceBetween(userLocation!.latitude,
      //     userLocation!.longitude, loo.location.lat, loo.location.lng);
      route().then((value) {
        if (routePoints == null ||
            const DeepCollectionEquality().equals(routePoints, value) ==
                false) {
          setState(() {
            routePoints = value;
            logging.log.info("Route points: $routePoints");
          });
        }
      });
    }

    if (placemarkFound == false) {
      loo.getGeoAddress().then((value) {
        if (placemarkFound == false && value != null && value.isNotEmpty) {
          setState(() {
            logging.log.info("Got placemark: ${value[0]}");
            placemark = value[0];
            placemarkFound = true;
          });
        }
      });
    }

    logging.log.info(
      "DetailScreen build for loo ${loo.id} opening hours is $loo",
    );

    //var bounds =
    //    LatLngBounds(userLocation!.toLatLng(), loo.location.toLatLng());
    OsmData? loc;
    if (widget.foundLocation != null) {
      loc = widget.foundLocation;
    } else {
      loc = userLocation!;
    }

    double horizontalDistance = (loc!.location.latitude - loo.location.lat)
        .abs();
    double verticalDistance = (loc.location.longitude - loo.location.lng).abs();

    List<LatLng> points = [
      LatLng(
        loc.location.latitude - horizontalDistance,
        loc.location.longitude - verticalDistance,
      ),
      LatLng(
        loc.location.latitude + horizontalDistance,
        loc.location.longitude + verticalDistance,
      ),
    ];
    points.add(loc.location);
    var bounds = LatLngBounds.fromPoints(points); // from flutter_map
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Theme.of(context).colorScheme.onPrimary,
        foregroundColor: Theme.of(context)
            .colorScheme
            .primary, //backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        title: Text(loo.getName()),
        actions: <Widget>[
          TextButton(
            //backgroundColor: Theme.of(context).colorScheme.onPrimary,
            child: Column(children: [Icon(Icons.route), Text("Mode of Transport")]),
            //icon: Icon(Icons.replay),
            onPressed: () async {
              final result = await showRouteOptionsDialog(
                context,
                _routeOptions,
              );
              if (result != null) {
                setState(() {
                  _routeOptions = result;
                  distance = 0;
                  routePoints = null;
                });
              }
            },
          ),
          TextButton(
            //backgroundColor: Theme.of(context).colorScheme.onPrimary,
            child: Column(children: [Icon(Icons.navigation), Text("Navigate")]),
            //icon: Icon(Icons.replay),
            onPressed: () async {
              NavigationLauncher.navigateTo(lat: loo.location.lat, lng: loo.location.lng, transportType: _routeOptions.orsProfile);
            },
          ),
        ],
      ),
      body: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          return SizedBox(
            height: constraints.maxHeight,
            width: MediaQuery.of(context).size.width,
            child: Column(
              children: [
                SizedBox(
                  height: constraints.maxHeight * 0.65,
                  width: MediaQuery.of(context).size.width,
                  child: FlutterMap(
                    mapController: mapController,
                    options: MapOptions(
                      initialCenter: bounds.center,
                      initialCameraFit: CameraFit.bounds(
                        bounds: bounds,
                        padding: EdgeInsets.all(20),
                      ),
                    ),
                    children: [
                      MapUtil.instance.getTileLayer(),
                      CurrentLocationLayer(),
                      RichAttributionWidget(
                        attributions: [
                          // Suggested attribution for the OpenStreetMap public tile server
                          TextSourceAttribution(
                            'OpenStreetMap contributors',
                            onTap: () => launchUrl(
                              Uri.parse('https://openstreetmap.org/copyright'),
                            ),
                          ),
                        ],
                      ),
                      /* SimpleAttributionWidget(
                          source: Text('OpenStreetMap contributors'),
                          alignment: Alignment.bottomRight,
                        ), */
                      MarkerLayer(
                        markers: [
                          Marker(
                            width: 80.0,
                            height: 80.0,
                            point: LatLng(loo.location.lat, loo.location.lng),
                            child: Icon(
                              Icons.location_on,
                              color: Colors.red,
                              size: 40,
                            ),
                          ),
                        ],
                      ),
                      PolylineLayer(
                        polylines: [
                          if (routePoints != null && routePoints!.isNotEmpty)
                            Polyline(
                              points: routePoints ?? [],
                              color: Colors.red,
                              strokeWidth: 4.0,
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                SizedBox(
                  height: constraints.maxHeight * 0.35,
                  width: MediaQuery.of(context).size.width,
                  child: ListView(
                    padding: EdgeInsets.all(10),
                    children: [
                      Card(
                        child: ListTile(
                          title: Text(loo.getName()),
                          subtitle: (placemark == null)
                              ? Text(
                                  "Loading address...",
                                  style: Theme.of(context).textTheme.bodySmall,
                                )
                              : Text(
                                  "${placemark?.street}, ${placemark?.postalCode}, ${placemark?.country}\nRoute Distance: ${distance.toStringAsFixed(0)} m",
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                        ),
                      ),
                      Card(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            ListTile(
                              title: Text("Features"),

                              // subtitle: Text(
                              //   loo.getFeatures(),
                              //   style: Theme.of(context).textTheme.bodySmall,
                              // ),
                            ),
                            loo.featuresToRichText(context),
                            SizedBox(height: 10),
                          ],
                        ),
                      ),
                      Card(
                        child: ListTile(
                          title: Text(
                            "Opening Times",
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          subtitle: (loo.getOpeningTimes().isNotEmpty)
                              ? Row(
                                  children: [
                                    IntrinsicWidth(
                                      //flex: 1,
                                      child: Column(
                                        mainAxisAlignment:
                                            MainAxisAlignment.center,
                                        crossAxisAlignment:
                                            CrossAxisAlignment.stretch,
                                        children: loo
                                            .getOpeningTimes()
                                            .mapIndexed(
                                              (i, e) => Text(
                                                days[i],
                                                style: Theme.of(
                                                  context,
                                                ).textTheme.bodySmall,
                                              ),
                                            )
                                            .toList(),
                                      ),
                                    ),
                                    Spacer(),
                                    IntrinsicWidth(
                                      //flex: 1,
                                      child: Column(
                                        mainAxisAlignment:
                                            MainAxisAlignment.center,
                                        crossAxisAlignment:
                                            CrossAxisAlignment.stretch,
                                        children: loo
                                            .getOpeningTimes()
                                            .mapIndexed(
                                              (i, e) => (e.isEmpty)
                                                  ? Text(
                                                      "Closed",
                                                      style: Theme.of(
                                                        context,
                                                      ).textTheme.bodySmall,
                                                    )
                                                  : (e[0].compareTo("00:00") ==
                                                            0 &&
                                                        e[1].compareTo(
                                                              "00:00",
                                                            ) ==
                                                            0)
                                                  ? Text(
                                                      "Unknown",
                                                      style: Theme.of(
                                                        context,
                                                      ).textTheme.bodySmall,
                                                    )
                                                  : Text(
                                                      "${e[0]} - ${e[1]}",
                                                      style: Theme.of(
                                                        context,
                                                      ).textTheme.bodySmall,
                                                    ),
                                            )
                                            .toList(),
                                      ),
                                    ),
                                  ],
                                )
                              : Text(
                                  "No opening times available",
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                        ),
                      ),
                      Card(
                        child: ListTile(
                          title: Text(
                            "Notes",
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          subtitle: Text(
                            loo.getNotes(),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      ),
                    ],
                  ),
                  /*
                    Text("${loo.getName()} ${loo.getNotes()}"),
                    Text(loo.getFeatures()),
                    Text("${placemark?.street}"),
                    Text("${placemark?.postalCode}"),
                    Text("${placemark?.country}"),
                    */
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<List<LatLng>> route() async {
    if (routePoints != null) {
      return routePoints!;
    }
    // Initialize the openrouteservice with your API key.
    /*
    final OpenRouteService client = OpenRouteService(
      apiKey: Env.orsKey,
      defaultProfile: ORSProfile.footWalking,
    );
    */
    final service = OrsService(apiKey: Env.orsKey);
    OsmData loc = widget.foundLocation ?? userLocation!;
    // OsmData loc = userLocation!;
    //if (userLocation != null) {
    //OsmData loc = userLocation!;
    // Example coordinates to test between
    double startLat = loc.location.latitude;
    double startLng = loc.location.longitude;
    double endLat = loo.location.lat;
    double endLng = loo.location.lng;

    List<ORSCoordinate> routeCoordinates = [];
    try {
      // Form Route between coordinates
      /*
      routeCoordinates = await client.directionsRouteCoordsGet(
        startCoordinate: ORSCoordinate(latitude: startLat, longitude: startLng),
        endCoordinate: ORSCoordinate(latitude: endLat, longitude: endLng),
      );
      */
      final result = await service.getOrsRoute(
        start: [startLng, startLat],
        end: [endLng, endLat],
        routeOptions: _routeOptions,
      );
      routeCoordinates = result.geometry
          .map(
            (coord) => ORSCoordinate(latitude: coord[1], longitude: coord[0]),
          )
          .toList();
    } catch (e) {
      logging.log.severe("Error getting route: $e");
      routeCoordinates = [];
    }

    // Print the route coordinates
    // routeCoordinates.forEach(print);

    // Map route coordinates to a list of LatLng (requires google_maps_flutter package)
    // to be used in the Map route Polyline.
    return routeCoordinates
        .map((coordinate) => LatLng(coordinate.latitude, coordinate.longitude))
        .toList();

    // Create Polyline (requires Material UI for Color)
    // final Polyline routePolyline = Polyline(
    //   polylineId: PolylineId('route'),
    //   visible: true,
    //   points: routePoints,
    //   color: Colors.red,
    //   width: 4,
    // );

    // Use Polyline to draw route on map or do anything else with the data :)
    //}
    //return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public helper – call this from anywhere to show the dialog
// ─────────────────────────────────────────────────────────────────────────────

Future<RouteOptions?> showRouteOptionsDialog(
  BuildContext context,
  RouteOptions routeOptions,
) {
  return showDialog<RouteOptions>(
    context: context,
    barrierDismissible: false,
    builder: (_) => RouteOptionsDialog(initialOptions: routeOptions),
  );
}
