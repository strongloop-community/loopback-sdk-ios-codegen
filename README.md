# LoopBack iOS SDK CodeGen

The iOS CodeGen command line tool generates iOS client side LoopBack Model representations
in Objective-C by looking into the specified server application.

## How to Use

The following is an example of the usage applied to the test server provided under this directory:

 1. Run `npm install` in this directory to initialize the tool `bin/lb-ios` and the test server under `test-env/server`.
 *  Run `bin/lb-ios -p XX test-env/server/server test-env/client/ios/gen-src` 
 	to generate the models in Objective-C representation, 
 	where `XX` is the prefix attached to all the generated class names.

## How to Run the Unit Test

After performing the above steps, run the followings:

 1. Run the test server by `node test-env/server/server.js &`.
 *  Copy `LoopBack.framework` into `test-env/CodeGenTest/`,
    where `LoopBack.framework` is the one generated from 
    the latest [iOS SDK](https://github.com/strongloop/loopback-sdk-ios).
 *  Start xcode from `test-env/CodeGenTest/CodeGenTest.xcodeproj`.
 *  Run the CodeGenTests unit tests.


## Limitations

 * Currently only a part of the API is accessible by using this iOS SDK.
 	See `LoopBack/LBModel.h` and `LoopBack/LBPersistedModel.h` for details.


## Mailing List

Discuss features and ask questions on [LoopBack Forum](https://groups.google.com/forum/#!forum/loopbackjs).