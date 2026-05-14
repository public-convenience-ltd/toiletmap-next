enum TransportMode { car, hgv, walking, cycling, wheelchair }

class RouteOptions {
  final TransportMode mode;
  final Map<String, dynamic> restrictions;

  const RouteOptions(this.mode, {this.restrictions = const {}});

  String get orsProfile {
    switch (mode) {
      case TransportMode.car:
        return 'driving-car';
      case TransportMode.hgv:
        return 'driving-hgv';
      case TransportMode.walking:
        return 'foot-walking';
      case TransportMode.cycling:
        return 'cycling-regular';
      case TransportMode.wheelchair:
        return 'wheelchair';
    }
  }

  @override
  String toString() => 'RouteOptions(mode: $mode, restrictions: $restrictions)';
}