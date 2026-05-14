class WheelchairOptions {
  final String surfaceType = "cobblestone:flattened";
  final String trackType = "grade1";
  final String smoothnessType = "good";
  final double maximumSlopedKerb = 0.06;
  final int maximumIncline = 6;

  /// Converts to the ORS `restrictions` map format.
  Map<String, dynamic> toRestrictions() {
    final Map<String, dynamic> r = {};

    r['surface_type'] = surfaceType;
    r['track_type'] = trackType;
    r['smoothness_type'] = smoothnessType;
    r['maximum_sloped_kerb'] = maximumSlopedKerb;
    r['maximum_incline'] = maximumIncline;

    return r;
  }
}