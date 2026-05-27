import 'dart:io';
import 'package:url_launcher/url_launcher.dart';

class NavigationLauncher {
  static Future<void> navigateTo({
    required double lat,
    required double lng,
    required String transportType,
  }) async {
    Uri uri;
    String mode = 'd'; // default to driving
    switch (transportType) {
      case 'foot-walking':
      case 'wheelchair':
        mode = 'w';
        break;
      case 'cycling-regular':
      if (Platform.isIOS) {
          mode = 'c'; 
      } else {
        mode = 'b';
      }
        break;
      case 'driving-car':
      case 'driving-hgv':
        mode = 'd';
        break;
      case 'transit':
      default:
        mode = 'r';
    }

    if (Platform.isIOS) {
      uri = Uri.parse(
        'http://maps.apple.com/?daddr=$lat,$lng&dirflag=$mode',
      );
    } else {
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