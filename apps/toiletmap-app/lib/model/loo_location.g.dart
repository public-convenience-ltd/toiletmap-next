// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'loo_location.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LooLocation _$LooLocationFromJson(Map<String, dynamic> json) => LooLocation(
  (json['lat'] as num).toDouble(),
  (json['lng'] as num).toDouble(),
);

Map<String, dynamic> _$LooLocationToJson(LooLocation instance) =>
    <String, dynamic>{'lat': instance.lat, 'lng': instance.lng};
