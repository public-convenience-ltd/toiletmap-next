import 'dart:convert';

import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import 'package:http/http.dart' as http;

import '../util/logging.dart' as logging;
import '../util/map_util.dart';
import 'user_agent_client.dart';

class OsmData {
  String displayName = "Unknown Initial Location";
  final LatLng location;
  late final List<String> _options = <String>[];
  int id;

  OsmData({required this.location, this.id = 0});

  OsmData.withDisplayName({
    required this.location,
    required this.displayName,
    this.id = 0,
  });

  Future<String> assignDisplayName() async {
    String url = MapUtil.instance.getReverseGeocodeUrl(location);

    //print("Reverse geocode URL is $url");
    var client = UserAgentClient(
      // 'Great British Public Toilet Map Mobile App', http.Client());
      MapUtil.instance.getAppName(),
      http.Client(),
    );
    try {
      logging.log.info("OsmData Search for $url");
      http.Response response = await client.get(Uri.parse(url));

      var decodedResponse =
          jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      logging.log.info("decoded response $decodedResponse");
      if (decodedResponse.isNotEmpty) {
        displayName = decodedResponse['display_name'] as String;
        logging.log.info("OsmData found $displayName");
      } else {
        displayName = "Unknown location";
        logging.log.warning("OsmData found no results");
      }
      logging.log.info("Options $_options[0].displayName");
    } on Exception catch (e) {
      logging.log.severe("OSM Error: $e");
    } finally {
      client.close();
    }
    return displayName;
  }

  @override
  String toString() {
    return 'OSMData{displayName: $displayName, location: $location}';
  }

  double getDistance(OsmData otherLocation) {
    double distance = Geolocator.distanceBetween(
      otherLocation.location.latitude,
      otherLocation.location.longitude,
      location.latitude,
      location.longitude,
    );
    // print('Distance between $this and $otherLocation is $distance');
    return distance;
  }

  @override
  bool operator ==(Object other) {
    if (other.runtimeType != runtimeType) {
      return false;
    }
    return other is OsmData &&
        other.location.latitude == location.latitude &&
        other.location.longitude == location.longitude;
  }

  @override
  int get hashCode =>
      Object.hash(displayName, location.latitude, location.longitude);

  Map<String, dynamic> toMapForDb() {
    if (id == 0) {
      return {
        'address': displayName,
        'latitude': location.latitude,
        'longitude': location.longitude,
      };
    }
    return {
      'latitude': location.latitude,
      'longitude': location.longitude,
      'address': displayName,
      'id': id,
    };
  }

  OsmData.fromDb(Map<String, dynamic> map)
    : id = map['id'],
      displayName = map['address'],
      location = LatLng(map['latitude'], map['longitude']);

  String get formattedAddress => '$displayName';
}
