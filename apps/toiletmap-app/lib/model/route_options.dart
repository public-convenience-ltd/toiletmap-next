enum TransportMode { car, hgv, walking, cycling, wheelchair, transit }

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
      case TransportMode.transit:
        return 'driving-car';
    }
  }

  String get googleMapsMode {
    switch (mode) {
      case TransportMode.car:
      case TransportMode.hgv:
        return 'd';
      case TransportMode.walking:
      case TransportMode.wheelchair:
        return 'w';
      case TransportMode.cycling:
        return 'b';
      case TransportMode.transit:
        return 'r';
      default:
        return 'w';
    }
  }

  String get appleMapsMode {
    switch (mode) {
      case TransportMode.car:
      case TransportMode.hgv:
        return 'd';
      case TransportMode.walking:
      case TransportMode.wheelchair:
        return 'w';
      case TransportMode.cycling:
        return 'c';
      case TransportMode.transit:
        return 'r';
      default:
        return 'w';
    }
  }
  
  TransportMode get transportMode => mode;

  @override
  String toString() => 'RouteOptions(mode: $mode, restrictions: $restrictions)';
}