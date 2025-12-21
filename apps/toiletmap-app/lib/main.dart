import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'bottom_nav_bar_controller.dart';
import 'location/location_service.dart';
import 'model/osm_data.dart';
import 'util/logging.dart' as logging;
import 'util/map_util.dart';
import 'themes/main_theme.dart';

Future<void> main() async {
  logging.setupLogging();

  runApp(ToiletApp());
}

class ToiletApp extends StatefulWidget {
  const ToiletApp({super.key});

  @override
  State<ToiletApp> createState() => _ToiletAppState();
}

class _ToiletAppState extends State<ToiletApp> {
  @override
  void initState() {
    super.initState();
    //LocationService.instance;
    logging.log.info("ToiletApp initialized");
  }

  // This widget is the root of your application.
  @override
  Widget build(BuildContext context) {
    // GeolocatorPlatform.instance.checkPermission().then((isPermission) {
    //   if (isPermission == LocationPermission.denied ||
    //       isPermission == LocationPermission.deniedForever) {
    
    //         logging.log.info("permissions denied");
    //   } else {
    //     logging.log.info("Permissions allowed");
    //   }
    // });
    return StreamProvider<OsmData>(
      create: (context) => LocationService.instance.locationStream,
      initialData: LocationService.instance.lastLocation,
      updateShouldNotify: (previous, current) {
        if ((previous.location.latitude == 0.0 ||
                previous.location.longitude == 0) &&
            current.location.latitude != 0.0 &&
            current.location.longitude != 0.0) {
          logging.log.info(
            "LocationService update first location ${current.location.toString()}",
          );
          return true;
        }
        double distance = previous.getDistance(current);
        logging.log.info(
          "LocationService updateShouldNotify called $previous to $current with distance $distance",
        );
        return distance > MapUtil.instance.getSearchRadius();
        //return true;
      },
      child: MaterialApp(
        title: 'Toilet Map',
        home: BottomNavigationBarController(),
        theme: getMainTheme(context),
      ),
    );
  }

  @override
  void dispose() {
    LocationService.instance.dispose();
    super.dispose();
  }
}
