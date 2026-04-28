import 'package:email_validator/email_validator.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/svg.dart';
import 'package:http/http.dart' as http;
import 'package:toilet_map_2/model/user_agent_client.dart';
import 'package:toilet_map_2/util/map_util.dart';

class FeedbackPage extends StatefulWidget {
  const FeedbackPage({super.key});

  @override
  State<FeedbackPage> createState() => _FirstPageState();
}

class _FirstPageState extends State<FeedbackPage> {
  // Create a global key that uniquely identifies the Form widget
  // and allows validation of the form.
  //
  // Note: This is a `GlobalKey<FormState>`,
  // not a GlobalKey<MyCustomFormState>.
  final _formKey = GlobalKey<FormState>();
  final feedbackTextController = TextEditingController();
  final emailAddressController = TextEditingController();

  @override
  void initState() {
    super.initState();
    // feedbackTextController.addListener(() {
    //   final String text = feedbackTextController.text;
    //   feedbackTextController.value = feedbackTextController.value.copyWith(
    //     text: text,
    //     selection: TextSelection(baseOffset: text.length, extentOffset: text.length),
    //     composing: TextRange.empty,
    //   );
    // });
    emailAddressController.addListener(() {
      final String text = emailAddressController.text.trim();
      emailAddressController.value = feedbackTextController.value.copyWith(
        text: text,
        selection: TextSelection(
          baseOffset: text.length,
          extentOffset: text.length,
        ),
        composing: TextRange.empty,
      );
    });
  }

  @override
  void dispose() {
    feedbackTextController.dispose();
    emailAddressController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const String assetName = 'assets/logo.svg';
    final Widget svg = SvgPicture.asset(
      assetName,
      semanticsLabel: 'App Logo',
      height: 32,
      width: 32,
    );

    return Scaffold(
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
      appBar: AppBar(
        backgroundColor: Theme.of(context).colorScheme.onPrimary,
        foregroundColor: Theme.of(context)
            .colorScheme
            .primary, //backgroundColor: Theme.of(context).colorScheme.onPrimary,
        // Here we take the value from the MyHomePage object that was created by
        // the App.build method, and use it to set our AppBar title.
        title: svg,

        /* title: SvgPicture.asset(
          'assets/images/logo.svg',
          semanticsLabel: 'Toilet Map Logo',
          height: 40,
          width: 40,
        ), */
      ),
      body: Form(
        key: _formKey,
        child: Padding(
          padding: EdgeInsets.all(10.0),
          child: Container(
            color: Theme.of(context).colorScheme.onPrimary,
            child: Column(
              children: <Widget>[
                // Add TextFormFields and ElevatedButton here.
                Text(
                  "Feedback",
                  style: Theme.of(context).textTheme.headlineLarge!.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
                Text(
                  "The Toilet Map is a free and open source project that we maintain in our spare time.  We'd be so grateful if you could take a moment to give us feedback on how we could make your experience even better.",
                ),
                TextFormField(
                  controller: feedbackTextController,
                  keyboardType: TextInputType.multiline,
                  minLines: 3,
                  maxLines: 10,
                  expands: false,
                  decoration: const InputDecoration(
                    icon: Icon(Icons.feedback_outlined),
                    hintText: 'Enter your feedback',
                    labelText: 'Feedback',
                  ),
                  style: Theme.of(context).textTheme.bodyMedium!.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  // The validator receives the text that the user has entered.
                  validator: (value) {
                    if (value == null || value.isEmpty || value.trim() == '') {
                      return 'Please enter some text';
                    }
                    return null;
                  },
                ),
                TextFormField(
                  controller: emailAddressController,
                  decoration: const InputDecoration(
                    icon: Icon(Icons.email_outlined),
                    hintText: 'Enter your email address',
                    labelText: 'Email (optional)',
                  ),
                  style: Theme.of(context).textTheme.bodyMedium!.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  validator: (value) => (value == null || value.isEmpty || value.trim() == '')
                      ? null
                      : (EmailValidator.validate(value)
                            ? null
                            : "Please enter a valid email"),
                ),
                ElevatedButton(
                  onPressed: () {
                    // Validate returns true if the form is valid, or false otherwise.
                    if (_formKey.currentState!.validate()) {
                      String feedbackValue = feedbackTextController.text;
                      String emailValue = emailAddressController.text;
                      // If the form is valid, display a snackbar. In the real world,
                      // you'd often call a server or save the information in a database.
                      sendFeedback(feedbackValue, emailValue);
                    } else {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Please fix the errors.')),
                      );
                    }
                  },
                  child: const Text('Submit'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void sendFeedback(String feedbackValue, String emailValue) async {
    var client = UserAgentClient(
      // 'Great British Public Toilet Map Mobile App', http.Client());
      MapUtil.instance.getAppName(),
      http.Client(),
    );
    var messenger = ScaffoldMessenger.of(context);
    http.Response response = await client.feedback(feedbackValue, emailValue);
    if (response.statusCode == 200) {
      if (context.mounted) {
        messenger.showSnackBar(
          SnackBar(content: Text('Your feedback has been submitted.')),
        );
      }
    } else {
      if (context.mounted) {
        messenger.showSnackBar(SnackBar(content: Text('Error ${response.statusCode}')));
      }
    }
    feedbackTextController.clear();
    emailAddressController.clear();
  }
}
