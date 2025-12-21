import 'dart:async';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import '../model/osm_data.dart';
import '../util/logging.dart' as logging;

/*
  * This class is responsible for getting the user's location and
  * providing it to the rest of the app.
  * See https://www.filledstacks.com/snippet/build-a-flutter-location-service/
  * For an alternative using the geolocator package see:
  * https://www.dhiwise.com/post/maximizing-user-experience-integrating-flutter-geolocator
  */

class LocationService {
  static LocationService? _instance;
  LocationService._();

  static LocationService get instance => _instance ??= LocationService._();

  // UserLocation lastLocation= UserLocation(latitude: 0.0, longitude: 0.0);
  OsmData lastLocation = OsmData(location: LatLng(0.0, 0.0));
  final StreamController<OsmData> _locationController =
      StreamController<OsmData>();
  Stream<OsmData> get locationStream => _locationController.stream;
  bool isRequesting = false;

  // final LocationSettings locationSettings = LocationSettings(
  //   accuracy: LocationAccuracy.high,
  //   distanceFilter: 100,
  // );

  Future<OsmData> locationPermissions() async {
    //GeolocatorPlatform.instance.isLocationServiceEnabled().then((enabled) {
      logging.log.info("LocationPermissions called... ");
    //});

    bool serviceEnabled;
    LocationPermission permission;

    // Test if location services are enabled.
    serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      // Location services are not enabled don't continue
      // accessing the position and request users of the
      // App to enable the location services.
      logging.log.info("Location services are disabled.");
      return Future.error('Location services are disabled.');
    }

    logging.log.info("About to check permissions ");

    permission = await Geolocator.checkPermission();
    logging.log.info("Permission is ${permission.toString()}");
    if (permission == LocationPermission.denied && !isRequesting) {
      logging.log.info("Requesting permission...");
      isRequesting = true;
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        // Permissions are denied, next time you could try
        // requesting permissions again (this is also where
        // Android's shouldShowRequestPermissionRationale
        // returned true. According to Android guidelines
        // your App should show an explanatory UI now.
        logging.log.info("Location permissions are denied.");
        return Future.error('Location permissions are denied');
      }
    }
    logging.log.info("Permission (2) is ${permission.toString()}");

    if (permission == LocationPermission.deniedForever) {
      // Permissions are denied forever, handle appropriately.
      logging.log.info(
        "Location permissions are permanently denied, we cannot request permissions.",
      );
      return Future.error(
        'Location permissions are permanently denied, we cannot request permissions.',
      );
    }
    logging.log.info("About to request current position");
    Position position = await GeolocatorPlatform.instance.getCurrentPosition();
    lastLocation = OsmData(
      location: LatLng(position.latitude, position.longitude),
    );
    LocationSettings locationSettings = LocationSettings(
      distanceFilter: 100,
    ); //, timeLimit: Duration(minutes:1, seconds: 0));
    logging.log.info("About to start listening for location updates");
    GeolocatorPlatform.instance
        .getPositionStream(locationSettings: locationSettings)
        .listen((locationData) {
          logging.log.info(
            "2. Location Update is ${locationData.latitude} ${locationData.longitude}",
          );
          OsmData newLocation = OsmData(
            location: LatLng(locationData.latitude, locationData.longitude),
          );

          _locationController.add(newLocation);
          lastLocation = newLocation;
        });
    return lastLocation;
  }

  void dispose() {
    _locationController.close();
  }
}
