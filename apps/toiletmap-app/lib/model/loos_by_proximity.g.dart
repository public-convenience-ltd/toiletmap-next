// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'loos_by_proximity.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LoosByProximity _$LoosByProximityFromJson(Map<String, dynamic> json) =>
    LoosByProximity(
      (json['loosByProximity'] as List<dynamic>)
          .map((e) => Loo.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$LoosByProximityToJson(LoosByProximity instance) =>
    <String, dynamic>{'loosByProximity': instance.loosByProximity};
