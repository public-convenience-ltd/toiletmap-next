import 'dart:io';
import 'package:url_launcher/url_launcher.dart';

import '../model/route_options.dart';

class NavigationLauncher {
  static Future<void> navigateTo({
    required double lat,
    required double lng,
    required RouteOptions options,
  }) async {
    Uri uri;

    if (Platform.isIOS) {
      final String mode = options.appleMapsMode;
      uri = Uri.parse(
        'http://maps.apple.com/?daddr=$lat,$lng&dirflag=$mode',
      );
    } else {
      final String mode = options.googleMapsMode;
      uri = Uri.parse(
        'google.navigation:q=$lat,$lng&mode=$mode',
      );
    }

    if (!await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    )) {
      throw Exception('Could not launch navigation');
    }
  }
}