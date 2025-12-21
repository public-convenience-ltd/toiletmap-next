import 'package:json_annotation/json_annotation.dart';
import 'package:latlong2/latlong.dart';

part 'loo_location.g.dart';

@JsonSerializable(includeIfNull: false)
class LooLocation {
  double lat;
  double lng;

  LooLocation(this.lat, this.lng);

  factory LooLocation.fromJson(Map<String, double> json) =>
      _$LooLocationFromJson(json);

  Map<String, dynamic> toJson() => _$LooLocationToJson(this);

  LatLng toLatLng() {
    return LatLng(lat, lng);
  }
}
