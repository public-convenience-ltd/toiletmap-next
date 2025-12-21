import 'package:json_annotation/json_annotation.dart';
import '../util/logging.dart' as logging;
import 'loos_by_proximity.dart';

part 'response_data.g.dart';

@JsonSerializable(includeIfNull: false)
class ResponseData {
  LoosByProximity data;

  ResponseData(this.data);

  factory ResponseData.fromJson(Map<String, dynamic> json) {
    try {
      return _$ResponseDataFromJson(json);
    } catch (e) {
      logging.log.severe("Error parsing ResponseData: $e");
      return ResponseData(LoosByProximity([]));
    }
  }

  Map<String, dynamic> toJson() => _$ResponseDataToJson(this);
}
