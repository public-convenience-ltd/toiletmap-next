/// Parsed ORS route response.
class RouteResult {
  final List<RouteSegment> segments;
  final double totalDistanceKm;
  final double totalDurationMinutes;
  final List<List<double>> geometry; // decoded polyline as [lon, lat] pairs

  const RouteResult({
    required this.segments,
    required this.totalDistanceKm,
    required this.totalDurationMinutes,
    required this.geometry,
  });

  factory RouteResult.fromJson(Map<String, dynamic> json) {
    final routes = json['routes'] as List;
    final route = routes.first as Map<String, dynamic>;

    final summary = route['summary'] as Map<String, dynamic>;
    final totalDist = (summary['distance'] as num).toDouble(); // km
    final totalDur = (summary['duration'] as num).toDouble() / 60.0; // seconds→minutes

    // Decode geometry (encoded polyline or coordinate list)
    List<List<double>> geometry = [];
    if (route['geometry'] is String) {
      geometry = _decodePolyline(route['geometry'] as String);
    } else if (route['geometry'] is Map) {
      final coords = (route['geometry']['coordinates'] as List)
          .map((c) => [(c[0] as num).toDouble(), (c[1] as num).toDouble()])
          .toList();
      geometry = coords;
    }

    final segments = (route['segments'] as List)
        .map((s) => RouteSegment.fromJson(s as Map<String, dynamic>))
        .toList();

    return RouteResult(
      segments: segments,
      totalDistanceKm: totalDist,
      totalDurationMinutes: totalDur,
      geometry: geometry,
    );
  }

  /// Decode Google-style encoded polyline.
  static List<List<double>> _decodePolyline(String encoded) {
    final List<List<double>> points = [];
    int index = 0;
    int lat = 0, lng = 0;

    while (index < encoded.length) {
      int b, shift = 0, result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      final dlat = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      final dlng = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
      lng += dlng;

      points.add([lng / 1e5, lat / 1e5]); // [lon, lat]
    }
    return points;
  }
}

class RouteSegment {
  final double distanceKm;
  final double durationMinutes;
  final List<RouteStep> steps;

  const RouteSegment({
    required this.distanceKm,
    required this.durationMinutes,
    required this.steps,
  });

  factory RouteSegment.fromJson(Map<String, dynamic> json) {
    return RouteSegment(
      distanceKm: (json['distance'] as num).toDouble(),
      durationMinutes: (json['duration'] as num).toDouble() / 60.0,
      steps: (json['steps'] as List)
          .map((s) => RouteStep.fromJson(s as Map<String, dynamic>))
          .toList(),
    );
  }
}

class RouteStep {
  final String instruction;
  final double distanceKm;
  final double durationMinutes;
  final String? roadName;
  final int type; // manoeuvre type code

  const RouteStep({
    required this.instruction,
    required this.distanceKm,
    required this.durationMinutes,
    this.roadName,
    required this.type,
  });

  factory RouteStep.fromJson(Map<String, dynamic> json) {
    // Strip HTML tags from instruction
    final raw = (json['instruction'] as String?) ?? '';
    final plain = raw.replaceAll(RegExp(r'<[^>]*>'), '');
    return RouteStep(
      instruction: plain,
      distanceKm: (json['distance'] as num).toDouble(),
      durationMinutes: (json['duration'] as num).toDouble() / 60.0,
      roadName: json['name'] as String?,
      type: (json['type'] as num?)?.toInt() ?? 0,
    );
  }
}
