/// Represents the vehicle-specific restrictions sent to ORS for driving-hgv.
/// All weight values are in tonnes, dimensions in metres.
class HgvOptions {
  /// Total vehicle weight including cargo (tonnes).
  final double? weight;

  /// Axle load (tonnes).
  final double? axleLoad;

  /// Vehicle height (metres).
  final double? height;

  /// Vehicle width (metres).
  final double? width;

  /// Vehicle length (metres).
  final double? length;

  /// Whether the vehicle is carrying hazardous materials.
  final bool hazardousMaterials;

  /// Whether the vehicle is carrying goods (affects certain routing decisions).
  final bool goodsDelivery;

  const HgvOptions({
    this.weight,
    this.axleLoad,
    this.height,
    this.width,
    this.length,
    this.hazardousMaterials = false,
    this.goodsDelivery = false,
  });

  /// Converts to the ORS `restrictions` map format.
  Map<String, dynamic> toRestrictions() {
    final Map<String, dynamic> r = {};

    if (weight != null) r['weight'] = weight;
    if (axleLoad != null) r['axleload'] = axleLoad;
    if (height != null) r['height'] = height;
    if (width != null) r['width'] = width;
    if (length != null) r['length'] = length;
    if (hazardousMaterials) r['hazmat'] = true;

    return r;
  }

  HgvOptions copyWith({
    double? weight,
    double? axleLoad,
    double? height,
    double? width,
    double? length,
    bool? hazardousMaterials,
    bool? goodsDelivery,
  }) {
    return HgvOptions(
      weight: weight ?? this.weight,
      axleLoad: axleLoad ?? this.axleLoad,
      height: height ?? this.height,
      width: width ?? this.width,
      length: length ?? this.length,
      hazardousMaterials: hazardousMaterials ?? this.hazardousMaterials,
      goodsDelivery: goodsDelivery ?? this.goodsDelivery,
    );
  }

  @override
  String toString() => 'HgvOptions(weight: $weight t, axleLoad: $axleLoad t, '
      'height: $height m, width: $width m, length: $length m, '
      'hazmat: $hazardousMaterials)';
}
