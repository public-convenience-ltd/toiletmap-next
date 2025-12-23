import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';

//import 'admin_geo.dart';
import 'package:json_annotation/json_annotation.dart';
import 'package:latlong2/latlong.dart';

import '../util/logging.dart' as logging;
import '../util/map_util.dart';
import 'loo_location.dart';

part 'loo.g.dart';

enum Features {
  accessible,
  radar,
  allGender,
  babyChange,
  men,
  women,
  noPayment,
}

@JsonSerializable(includeIfNull: false)
class Loo {
  /*
{
	loosByProximity(from: {lat: 52.396423, lng: -1.9812912, maxDistance: 3000})
	{
		id
		name
		location {
			lat
			lng
		}
		accessible
		allGender
		men
		women
		openingTimes
		babyChange
		noPayment
		urinalOnly
		radar
		attended
		active
	}
}
*/

  @JsonKey(required: true)
  String id;
  @JsonKey(defaultValue: "This loo has no name")
  String? name;
  @JsonKey(required: true)
  bool active;
  @JsonKey(required: true)
  LooLocation location;
  @JsonKey(defaultValue: "No additional notes for this loo")
  String? notes;
  @JsonKey(defaultValue: false)
  bool? accessible; //: Boolean
  @JsonKey(defaultValue: false)
  bool? allGender; //: Boolean
  @JsonKey(defaultValue: false)
  bool? men; //: Boolean
  @JsonKey(defaultValue: false)
  bool? women; //: Boolean
  @JsonKey(defaultValue: false)
  bool? urinalOnly; //: Boolean
  @JsonKey(defaultValue: false)
  bool? babyChange; //: Boolean
  @JsonKey(defaultValue: false)
  bool? radar; //: Boolean
  @JsonKey(defaultValue: false)
  bool? attended; //: Boolean
  @JsonKey(defaultValue: false)
  bool? noPayment; //: Boolean
  @JsonKey(
    defaultValue: [
      ["00:00", "00:00"],
      ["00:00", "00:00"],
      ["00:00", "00:00"],
      ["00:00", "00:00"],
      ["00:00", "00:00"],
      ["00:00", "00:00"],
      ["00:00", "00:00"],
    ],
  )
  List<List<String>>? openingTimes;

  Loo(
    this.id,
    this.name,
    this.active,
    this.location,
    this.notes,
    this.accessible,
    this.allGender,
    this.attended,
    this.babyChange,
    this.men,
    this.noPayment,
    this.radar,
    this.urinalOnly,
    this.women,
    this.openingTimes,
  );

  factory Loo.fromJson(Map<String, dynamic> json) => _$LooFromJson(json);

  Map<String, dynamic> toJson() => _$LooToJson(this);

  List<String> getFeatureList() {
    List<String> featureList = [];
    if (accessible != null && accessible == true) {
      featureList.add(Features.accessible.name);
    }
    if (radar != null && radar == true) {
      featureList.add(Features.radar.name);
    }
    if (allGender != null && allGender == true) {
      featureList.add(Features.allGender.name);
    }
    if (babyChange != null && babyChange == true) {
      featureList.add(Features.babyChange.name);
    }
    if (men != null && men == true) {
      featureList.add(Features.men.name);
    }
    if (women != null && women == true) {
      featureList.add(Features.women.name);
    }
    if (noPayment != null && noPayment == true) {
      featureList.add(Features.noPayment.name);
    }
    return featureList;
  }

  String getFeatures() {
    List<String> features = getFeatureList();
    String result = "| ";
    for (var i = 0; i < features.length; i++) {
      String feature = prettyFeature(features[i]);
      String space = "";
      if (i < features.length - 1) {
        space = " ";
      }
      result = "$result $feature |$space";
    }
    return result;
  }

  Widget featuresToRichText(BuildContext context) {
    List<String> features = getFeatureList();
    List<InlineSpan> children = [];
    //String result = "| ";
    for (String feature in features) {
      InlineSpan icon = WidgetSpan(
        child: Icon(
          featureIcon(feature),
          color: Theme.of(context).colorScheme.primary,
        ),
      );
      InlineSpan text = TextSpan(
        text: prettyFeature(feature),
        style: TextStyle(color: Theme.of(context).colorScheme.primary),
      );
      InlineSpan gap = TextSpan(text: " ");
      // InlineSpan divider = TextSpan(
      //   text: "|",
      //   style: Theme.of(context).textTheme.bodySmall,
      // );
      // if (i < features.length - 1) {
      //   space = space = gap;
      // }
      //result = "$result $feature |$space";
      children.add(icon);
      children.add(gap);
      children.add(text);
      children.add(gap);
    }
    Widget richText = RichText(text: TextSpan(children: children));
    return richText;
  }

  String getName() {
    return name ?? "This loo has no name";
  }

  void setName(String newName) {
    name ??= "This loo has no name";
  }

  String getNotes() {
    return notes ?? "No additional notes for this loo";
  }

  void setNotes(String newNotes) {
    notes ??= "No additional notes for this loo";
  }

  List<List<String>> getOpeningTimes() {
    logging.log.info(
      "Getting opening times for loo $id they are $openingTimes",
    );
    if (openingTimes == null || openingTimes!.isEmpty) {
      logging.log.info("No opening times");
      return [];
    }
    logging.log.info("Opening times: $openingTimes");
    return openingTimes!;
  }

  bool hasRequiredFeature() {
    if (!active) {
      return false;
    }
    Map<String, FilterItem> filters = MapUtil.instance.filterData;
    for (String feature in filters.keys) {
      if (filters[feature]?.getIsOn() == true) {
        bool has = hasFeature(feature);
        //logging.log.info("Loo $id has feature $feature: $has");
        if (has) {
          return true;
        }
      }
    }
    return false;
  }

  Future<List<Placemark>?> getGeoAddress() async {
    try {
      //List<Placemark>? newPlace = await GeocodingPlatform.instance
      //    ?.placemarkFromCoordinates(location.lat, location.lng);
      return await placemarkFromCoordinates(location.lat, location.lng);
      // return newPlace;
    } on PlatformException catch (err) {
      logging.log.severe(err);
      return null;
    }
  }

  int getDistance(LatLng location) {
    // Logging.log.info(
    //     "Get Distance from (${location.latitude}, ${location.longitude}) to (${this.location.lat}, ${this.location.lng})");
    return Geolocator.distanceBetween(
      location.latitude,
      location.longitude,
      this.location.lat,
      this.location.lng,
    ).round();
  }

  String prettyFeature(String feature) {
    switch (feature) {
      case "accessible":
        return "Accessible";
      case "radar":
        return "Radar Key";
      case "allGender":
        return "Gender Neutral";
      case "babyChange":
        return "Baby Change";
      case "men":
        return "Men";
      case "women":
        return "Women";
      case "urinalOnly":
        return "Urinal Only";
      case "children":
        return "Children";
      case "noPayment":
        return "Free";
      case "paymentDetails":
        return "Payment Details";
      case "attended":
        return "Attended";
      default:
        return feature;
    }
  }

  IconData featureIcon(String feature) {
    switch (feature) {
      case "accessible":
        return Icons.accessible;
      case "radar":
        return Icons.key;
      case "allGender":
        return Icons.wc;
      case "babyChange":
        return Icons.baby_changing_station;
      case "men":
        return Icons.man;
      case "women":
        return Icons.woman;
      case "urinalOnly":
        return Icons.man;
      case "children":
        return Icons.child_friendly;
      case "noPayment":
        return Icons.currency_pound;
      case "paymentDetails":
        return Icons.currency_pound;
      case "attended":
        return Icons.cleaning_services;
      default:
        return Icons.check;
    }
  }

  bool hasFeature(String feature) {
    //logging.log.info("Checking for feature $feature");
    switch (feature) {
      case "accessible":
        return accessible == true;
      case "radar":
        return radar == true;
      case "allGender":
        return allGender == true;
      case "babyChange":
        return babyChange == true;
      case "men":
        return men == true;
      case "women":
        return women == true;
      case "noPayment":
        return noPayment == true;
      case "urinalOnly":
        return urinalOnly == true;
      case "attended":
        return attended == true;
      default:
        return false;
    }
  }
}
