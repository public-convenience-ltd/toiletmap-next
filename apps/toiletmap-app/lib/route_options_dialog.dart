import 'package:flutter/material.dart';
import 'package:toilet_map_2/model/route_options.dart';

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

  @override
  void initState() {
    super.initState();
    _selectedMode = widget.initialOptions.transportMode;
  }

  void _cancel() => Navigator.of(context).pop();

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
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
                                Text('Driving'),
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
                            value: TransportMode.cycling,
                            child: Row(
                              children: [
                                Icon(Icons.directions_bike_rounded, size: 18),
                                SizedBox(width: 8),
                                Text('Cycling'),
                              ],
                            ),
                          ),
                          DropdownMenuItem(
                            value: TransportMode.transit,
                            child: Row(
                              children: [
                                Icon(Icons.directions_transit_rounded, size: 18),
                                SizedBox(width: 8),
                                Text('Public Transport'),
                              ],
                            ),
                          ),
                        ],
                        onChanged: (v) {
                          if (v != null) setState(() => _selectedMode = v);
                        },
                      ),
                      //const SizedBox(height: 20),

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
}
