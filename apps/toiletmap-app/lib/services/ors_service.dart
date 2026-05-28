import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:toilet_map_2/model/route_options.dart';
import '../model/route_result.dart';

class OrsService {
  static const String _baseUrl = 'https://api.openrouteservice.org/v2/directions';
  //static const String _profile = 'driving-hgv';

  final String apiKey;

  OrsService({required this.apiKey});

  /// Request an HGV route from ORS.
  /// [start] and [end] are [longitude, latitude] pairs.
  Future<RouteResult> getOrsRoute({
    required List<double> start,
    required List<double> end,
    //required HgvOptions hgvOptions,
    required RouteOptions routeOptions,
  }) async {
    String profile = routeOptions.orsProfile;
    final url = Uri.parse('$_baseUrl/$profile/json');

    final body = {
      'coordinates': [start, end],
      'instructions': true,
      'instructions_format': 'html',
      'units': 'km',
      'language': 'en',
      //'options': routeOptions.restrictions,
    };

    final response = await http.post(
      url,
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json, application/geo+json',
      },
      body: jsonEncode(body),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      return RouteResult.fromJson(json);
    } else {
      final errorBody = jsonDecode(response.body);
      final message = errorBody['error']?['message'] ??
          errorBody['message'] ??
          'HTTP ${response.statusCode}';
      throw OrsException(message, response.statusCode);
    }
  }
}

class OrsException implements Exception {
  final String message;
  final int statusCode;
  const OrsException(this.message, this.statusCode);

  @override
  String toString() => 'OrsException($statusCode): $message';
}
