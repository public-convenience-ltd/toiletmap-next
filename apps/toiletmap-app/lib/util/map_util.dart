import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../model/osm_data.dart';
import '../model/response_data.dart';
import 'logging.dart' as logging;

class MapUtil {
  static MapUtil? _instance;
  SharedPreferences? preferences;

  MapUtil._() {
    getPreferences();
  }

  Future<void> getPreferences() async {
    preferences = await SharedPreferences.getInstance();
  }

  static MapUtil get instance => _instance ??= MapUtil._();

  static Uri feedbackLink = Uri.https('www.toiletmap.org.uk', 'api/feedback');

  static const String appName = 'uk.org.toiletmap.mobile_app/2.0';
  // this radius should go into shared preferences, leave here as default value
  double searchRadius = 2000.0; // in meters
  String units = 'meters'; // or 'imperial'
  bool changedFilters = false;

  // List<String> features = [
  //   "accessible",
  //   "allGender",
  //   "men",
  //   "women",
  //   "openingTimes",
  //   "babyChange",
  //   "noPayment",
  //   "urinalOnly",
  //   "radar",
  //   "attended",
  // ];

  // this data should go into shared preferences.  Leave here as default values
  static Map<String, bool> filters = {
    "accessible": true,
    "allGender": true,
    "men": true,
    "women": true,
    "openingTimes": true,
    "babyChange": true,
    "noPayment": true,
    "urinalOnly": true,
    "radar": true,
    "attended": true,
  };

  static List<String> features = MapUtil.filters.keys.toList();

  // FilterItem class should work with shared preferences.
  Map<String, FilterItem> filterData = {
    "accessible": FilterItem(
      "accessible",
      Icons.wheelchair_pickup,
      "Accessible",
    ),
    "allGender": FilterItem("allGender", Icons.wc, "All Gender"),
    "men": FilterItem("men", Icons.man, "Men"),
    "women": FilterItem("women", Icons.woman, "Women"),
    "openingTimes": FilterItem("openingTimes", Icons.timer, "Opening Times"),
    "babyChange": FilterItem(
      "babyChange",
      Icons.baby_changing_station,
      "Baby Change",
    ),
    "noPayment": FilterItem("noPayment", Icons.currency_pound, "Free"),
    "urinalOnly": FilterItem("urinalOnly", Icons.male, "Urinal Only"),
    "radar": FilterItem("radar", Icons.key, "Radar"),
    "attended": FilterItem("attended", Icons.person, "Attended"),
  };

  // Map<String, bool> getFilters() {
  //   return filters;
  // }

  void setSettingsChanged(bool changed) {
    changedFilters = changed;
  }

  bool getSettingsChanged() {
    return changedFilters;
  }

  String getFeatures() {
    return features.join(" ");
  }

  double getSearchRadius() {
    // get from preferences if available
    double radius =
        MapUtil.instance.preferences?.getDouble("radius") ?? searchRadius;
    return radius;
  }

  void setSearchRadius(double radius) async {
    await MapUtil.instance.preferences?.setDouble("radius", radius);
    searchRadius = radius;
    // save to preferences
  }

  String getUnits() {
    return units;
  }

  void setUnits(String units) {
    this.units = units;
  }

  String getFilterOptions() {
    List<String> activeFilters = [];
    filters.forEach((key, value) {
      if (value) {
        activeFilters.add(key);
      }
    });
    return activeFilters.join(" ");
  }

  TileLayer getTileLayer() {
    return TileLayer(
      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      // Protomaps - needs API key
      // urlTemplate:
      //    'https://api.protomaps.com/tiles/v3/{z}/{x}/{y}.mvt?key=73e8a482f059f3f5',
      userAgentPackageName: MapUtil.appName,
    );
  }

  String getAppName() {
    return MapUtil.appName;
  }

  String getSearchUrl(String value) {
    return 'https://nominatim.openstreetmap.org/search?q=$value&format=json&addressdetails=1&countrycodes=gb&limit=5&email=a.j.beaumont@aston.ac.uk';
  }

  String getReverseGeocodeUrl(LatLng location) {
    return 'https://nominatim.openstreetmap.org/reverse?lat=${location.latitude}&lon=${location.longitude}&format=json&addressdetails=1&email=a.j.beaumont@aston.ac.uk';
  }

  Future<ResponseData> fetchToilets(OsmData osm) async {
    // if (location == null) {
    //   return ResponseData(LoosByProximity([]));
    // }
    //var lat = 52.3760367;
    //var lng = -1.9955333;
    logging.log.info("requesting toilets from $osm");
    var lat = osm.location.latitude;
    var lng = osm.location.longitude;
    var params = MapUtil.instance.getFeatures();
    //"accessible allGender men women openingTimes babyChange noPayment urinalOnly radar attended";
    String radius = MapUtil.instance.getSearchRadius().toInt().toString();
    String query =
        "{loosByProximity(from: {lat: $lat, lng: $lng, maxDistance: $radius}){ id name active location{lat lng} notes $params}}";
    // Logging.log.info(query);
    final response = await http.get(
      Uri.parse('https://www.toiletmap.org.uk/api/?query=$query'),
    );

    if (response.statusCode == 200) {
      //logging.log.info('response body is ${response.body}');
      final dataMap = jsonDecode(response.body) as Map<String, dynamic>;
      logging.log.info("dataMap is $dataMap");
      var responseData = ResponseData.fromJson(dataMap);
      logging.log.info(
        "Parsed ${responseData.data.loosByProximity.length} toilets from response",
      );
      return responseData;
    } else {
      throw Exception('Failed to load users');
    }
  }
}

class FilterItem {
  late bool _isOn;
  late IconData icon;
  late String displayText;
  late String key;

  FilterItem(this.key, this.icon, this.displayText) {
    _isOn = true;
  }

  bool getIsOn() {
    bool prefValue = MapUtil.instance.preferences?.getBool(key) ?? _isOn;
    logging.log.info("getting filter key is $key value is $prefValue");
    return prefValue;
  }

  void setIsOn(bool isOn) async {
    // here is where we should update shared preferences
    await MapUtil.instance.preferences?.setBool(key, isOn);
    logging.log.info("saving filter $key value is $isOn");
    this._isOn = isOn;
  }
}
