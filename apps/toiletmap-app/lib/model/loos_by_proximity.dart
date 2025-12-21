import 'package:json_annotation/json_annotation.dart';
import 'loo.dart';

part 'loos_by_proximity.g.dart';

@JsonSerializable(includeIfNull: false)
class LoosByProximity {
  List<Loo> loosByProximity;

  LoosByProximity(this.loosByProximity);

  factory LoosByProximity.fromJson(Map<String, dynamic> json) =>
      _$LoosByProximityFromJson(json);

  Map<String, dynamic> toJson() => _$LoosByProximityToJson(this);
}
