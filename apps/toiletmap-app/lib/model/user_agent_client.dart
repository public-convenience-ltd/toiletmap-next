import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:toilet_map_2/util/map_util.dart';

class UserAgentClient extends http.BaseClient {
  final String userAgent;
  final http.Client _inner;

  UserAgentClient(this.userAgent, this._inner);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    request.headers['User-Agent'] = userAgent;
    return _inner.send(request);
  }

  Future<http.Response> feedback(String text, String email) async {
    PackageInfo packageInfo = await PackageInfo.fromPlatform();

    String appName = packageInfo.appName;
    String packageName = packageInfo.packageName;
    String version = packageInfo.version;
    String buildNumber = packageInfo.buildNumber;
    String routeText =
        "$appName $packageName Version: $version Build# $buildNumber";
    if (Platform.isAndroid) {
      // Android-specific code
      routeText += " Android";
    } else if (Platform.isIOS) {
      // iOS-specific code
      routeText += " iOS";
    }

    // use the next line and comment out the http.post for testing when you dont want to actually send the feedback
    //var response = http.Response(routeText, 200);
    try {
      var response = await http.post(
        MapUtil.feedbackLink,
        body: {'text': text, 'email': email, 'route': routeText},
      );
      return response;
    } catch (e) {
      //print("Error sending feedback: $e");
      return http.Response("Error sending feedback: $e", 500);
    }
    //return response;
  }
}
