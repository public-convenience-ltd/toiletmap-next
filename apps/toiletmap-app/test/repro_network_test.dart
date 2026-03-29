// ignore_for_file: avoid_print
import 'package:flutter_test/flutter_test.dart';
import 'package:toilet_map_2/util/map_util.dart';
import 'package:toilet_map_2/model/osm_data.dart';
import 'package:latlong2/latlong.dart';
import 'package:toilet_map_2/util/logging.dart' as logging;
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('Fetch toilets network request', () async {
    // Setup logging
    logging.setupLogging();

    print("Starting reproduction test...");
    
    // Mock SharedPreferences to avoid missing plugin error
    SharedPreferences.setMockInitialValues({});

    // Mock location (from user logs)
    final lat = 52.0261217;
    final lng = 0.1203017;
    final location = LatLng(lat, lng);
    final osmData = OsmData(location: location);

    print("Fetching toilets for location: $lat, $lng");

    try {
      final response = await MapUtil.instance.fetchToilets(osmData);
      print("Success!");
      print("Found ${response.data.loosByProximity.length} toilets.");
      if (response.data.loosByProximity.isNotEmpty) {
          print("First toilet: ${response.data.loosByProximity.first.name}");
      }
    } catch (e, stack) {
      print("Error fetching toilets:");
      print(e);
      print(stack);
      // Fail the test if it throws, so we see it in the output
      fail("Exception thrown: $e");
    }
  });
}