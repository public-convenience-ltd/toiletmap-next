import 'package:flutter/material.dart';
import 'package:toilet_map_2/model/route_options.dart';

import 'model/hgv_options.dart';
import 'model/hgv_options_form.dart';

class RouteOptionsDialog extends StatefulWidget {
  const RouteOptionsDialog({super.key, required this.initialOptions});

  final RouteOptions initialOptions;

  @override
  State<RouteOptionsDialog> createState() => _RouteOptionsDialogState();
}

class _RouteOptionsDialogState extends State<RouteOptionsDialog>
    with SingleTickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  TransportMode _selectedMode = TransportMode.walking;

  HgvOptions _hgvOptions = const HgvOptions(
    weight: 40.0,
    axleLoad: 11.5,
    height: 4.0,
    width: 2.55,
    length: 16.5,
    hazardousMaterials: false,
  );

  @override
  void initState() {
    super.initState();
    _selectedMode = widget.initialOptions.transportMode;
  }

  void _cancel() => Navigator.of(context).pop();

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
      if (TransportMode == TransportMode.hgv) {
        // For HGV, we need to include the additional options as restrictions
        final restrictions = {
          'hgv': {
            'weight': _hgvOptions.weight,
            'axleLoad': _hgvOptions.axleLoad,
            'height': _hgvOptions.height,
            'width': _hgvOptions.width,
            'length': _hgvOptions.length,
            'hazardousMaterials': _hgvOptions.hazardousMaterials,
          }
        };
        final options = RouteOptions(_selectedMode, restrictions: restrictions);
        Navigator.of(context).pop(options);
        return;
      }
      final options = RouteOptions(_selectedMode);
      Navigator.of(context).pop(options);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      clipBehavior: Clip.antiAlias,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 20, 24, 8),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // ── Dropdown ───────────────────────────────────────
                      DropdownButtonFormField<TransportMode>(
                        initialValue: _selectedMode,
                        decoration: InputDecoration(
                          labelText: 'Mode of transport',
                          icon: const Icon(Icons.commute_rounded),
                        ),
                        items: const [
                          DropdownMenuItem(
                            value: TransportMode.car,
                            child: Row(
                              children: [
                                Icon(Icons.directions_car_rounded, size: 18),
                                SizedBox(width: 8),
                                Text('Car'),
                              ],
                            ),
                          ),
                          DropdownMenuItem(
                            value: TransportMode.hgv,
                            child: Row(
                              children: [
                                Icon(Icons.local_shipping_rounded, size: 18),
                                SizedBox(width: 8),
                                Text('HGV'),
                              ],
                            ),
                          ),
                          DropdownMenuItem(
                            value: TransportMode.walking,
                            child: Row(
                              children: [
                                Icon(Icons.directions_walk_rounded, size: 18),
                                SizedBox(width: 8),
                                Text('Walking'),
                              ],
                            ),
                          ),
                          DropdownMenuItem(
                            value: TransportMode.wheelchair,
                            child: Row(
                              children: [
                                Icon(Icons.accessibility_new_rounded, size: 18),
                                SizedBox(width: 8),
                                Text('Wheelchair'),
                              ],
                            ),
                          ),
                          DropdownMenuItem(
                            value: TransportMode.cycling,
                            child: Row(
                              children: [
                                Icon(Icons.directions_bike_rounded, size: 18),
                                SizedBox(width: 8),
                                Text('Cycling'),
                              ],
                            ),
                          ),
                          
                        ],
                        onChanged: (v) {
                          if (v != null) setState(() => _selectedMode = v);
                        },
                      ),
                       const SizedBox(height: 20),

                          // ── Conditional sections ───────────────────────────
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 260),
                            transitionBuilder: (child, anim) => FadeTransition(
                              opacity: anim,
                              child: SizeTransition(
                                  sizeFactor: anim, child: child),
                            ),
                            child: _buildConditionalFields(),
                          ),

                          const SizedBox(height: 8),
                      // ── Actions ────────────────────────────────────────────────
                      const Divider(height: 1),
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 12,
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            TextButton(
                              onPressed: _cancel,
                              child: const Text('Cancel'),
                            ),
                            const SizedBox(width: 8),
                            FilledButton.icon(
                              onPressed: _submit,
                              icon: const Icon(Icons.check_rounded, size: 18),
                              label: const Text('Confirm'),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget? _buildConditionalFields() {
    switch (_selectedMode) {
      case TransportMode.car:
        return Text(
          'Additional car-specific options would go here.',
          style: TextStyle(color: Theme.of(context).colorScheme.primary),
        );
      case TransportMode.hgv:
        return SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            HgvOptionsForm(
                options: _hgvOptions,
                onChanged: (HgvOptions opts) => setState(() => _hgvOptions = opts),
              ),
          ],
        ),
      );

      case TransportMode.walking:
        return Text(
          'Additional walking-specific options would go here.',
          style: TextStyle(color: Theme.of(context).colorScheme.primary),
        );
      case TransportMode.wheelchair:
        return Text(
          'Additional wheelchair-specific options would go here.',
          style: TextStyle(color: Theme.of(context).colorScheme.primary),
        );
      case TransportMode.cycling:
        return Text(
          'Additional cycling-specific options would go here.',
          style: TextStyle(color: Theme.of(context).colorScheme.primary),
        );
    }
  }
}
