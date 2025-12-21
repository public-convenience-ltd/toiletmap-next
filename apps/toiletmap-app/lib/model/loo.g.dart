// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'loo.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Loo _$LooFromJson(Map<String, dynamic> json) {
  $checkKeys(json, requiredKeys: const ['id', 'active', 'location']);
  return Loo(
    json['id'] as String,
    json['name'] as String? ?? 'This loo has no name',
    json['active'] as bool,
    LooLocation.fromJson(
      (json['location'] as Map<String, dynamic>).map(
        (k, e) => MapEntry(k, (e as num).toDouble()),
      ),
    ),
    json['notes'] as String? ?? 'No additional notes for this loo',
    json['accessible'] as bool? ?? false,
    json['allGender'] as bool? ?? false,
    json['attended'] as bool? ?? false,
    json['babyChange'] as bool? ?? false,
    json['men'] as bool? ?? false,
    json['noPayment'] as bool? ?? false,
    json['radar'] as bool? ?? false,
    json['urinalOnly'] as bool? ?? false,
    json['women'] as bool? ?? false,
    (json['openingTimes'] as List<dynamic>?)
            ?.map((e) => (e as List<dynamic>).map((e) => e as String).toList())
            .toList() ??
        [],
  );
}

Map<String, dynamic> _$LooToJson(Loo instance) => <String, dynamic>{
  'id': instance.id,
  'name': ?instance.name,
  'active': instance.active,
  'location': instance.location,
  'notes': ?instance.notes,
  'accessible': ?instance.accessible,
  'allGender': ?instance.allGender,
  'men': ?instance.men,
  'women': ?instance.women,
  'urinalOnly': ?instance.urinalOnly,
  'babyChange': ?instance.babyChange,
  'radar': ?instance.radar,
  'attended': ?instance.attended,
  'noPayment': ?instance.noPayment,
  'openingTimes': ?instance.openingTimes,
};
