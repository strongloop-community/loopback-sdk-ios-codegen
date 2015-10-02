//
//  BookTest.m
//  ios-codegen-test
//
//  Created by hideya kawahara on 2015/08/21.
//
//

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import "XXBook.h"
#import "XXBookRepository.h"

@interface BookTest : XCTestCase

@property (nonatomic, strong) LBRESTAdapter *adapter;
@property (nonatomic, strong) XXBookRepository *repository;

@end

static NSString *bookTitle = @"The Hitchhiker's Guide to the Galaxy";
static NSString *bookAuthoer = @"Douglas Adams";
static long bookTotalPages = 224;
static NSArray *bookKeywords;

static NSString *altBookTitle = @"Mostly Harmless";
static long altBookTotalPages = 240;

static NSString *anotherBookTitle = @"A Farewell To Arms";
static NSString *anotherBookAuthoer = @"Ernest Hemingway";
static long anotherBookTotalPages = 352;

static NSNumber *createdId;


@implementation BookTest

/**
 * Create the default test suite to control the order of test methods
 */
+ (id)defaultTestSuite {
    XCTestSuite *suite = [XCTestSuite testSuiteWithName:@"TestSuite for LBFile."];
    [suite addTest:[self testCaseWithSelector:@selector(testCreate)]];
    [suite addTest:[self testCaseWithSelector:@selector(testFind)]];
    [suite addTest:[self testCaseWithSelector:@selector(testAll)]];
    [suite addTest:[self testCaseWithSelector:@selector(testUpdate)]];
    [suite addTest:[self testCaseWithSelector:@selector(testRemove)]];
    return suite;
}

- (void)setUp {
    [super setUp];

    self.adapter = [LBRESTAdapter adapterWithURL:[NSURL URLWithString:@"http://localhost:3010/api"]];
    self.repository = (XXBookRepository*)[self.adapter repositoryWithClass:[XXBookRepository class]];

    bookKeywords = @[ @"novel", @"sci-fi", @"comedy" ];
}

- (void)tearDown {
    // Put teardown code here. This method is called after the invocation of each test method in the class.
    [super tearDown];
}

- (void)testCreate {
    XXBook *book = (XXBook*)[self.repository modelWithDictionary:nil];
    book.title = bookTitle;
    book.author = bookAuthoer;
    book.totalPages = bookTotalPages;
    book.hardcover = YES;
    book.keywords = bookKeywords;

    ASYNC_TEST_START
    [book saveWithSuccess:^{
        NSLog(@"Completed with: %@", book._id);
        XCTAssertNotNil(book._id, @"Invalid id");
        createdId = book._id;
        ASYNC_TEST_SIGNAL
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testFind {
    ASYNC_TEST_START
    [self.repository findById:createdId success:^(LBPersistedModel *model) {
        XCTAssertNotNil(model, @"No model found");
        XCTAssertTrue([[model class] isSubclassOfClass:[XXBook class]], @"Invalid class.");
        XXBook *book = (XXBook *)model;
        XCTAssertEqualObjects(book.title, bookTitle, @"Invalid title");
        XCTAssertEqualObjects(book.author, bookAuthoer, @"Invalid author");
        XCTAssertEqual(book.totalPages, bookTotalPages, @"Invalid totalPages");
        XCTAssertEqual(book.hardcover, YES, @"Invalid hardcover property");
        XCTAssertEqualObjects(book.keywords, bookKeywords, @"Invalid keywords");
        ASYNC_TEST_SIGNAL
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testAll {
    // add one more book for testing
    XXBook *anotherBook = (XXBook*)[self.repository modelWithDictionary:nil];
    anotherBook.title = anotherBookTitle;
    anotherBook.author = anotherBookAuthoer;
    anotherBook.totalPages = anotherBookTotalPages;
    anotherBook.hardcover = YES;
    ASYNC_TEST_START
    [anotherBook saveWithSuccess:^{

        [self.repository allWithSuccess:^(NSArray *models) {

            BOOL foundBook1 = NO;
            BOOL foundBook2 = NO;

            XCTAssertNotNil(models, @"No models returned.");
            XCTAssertTrue([models count] >= 2, @"Invalid # of models returned: %lu", (unsigned long)[models count]);

            for (int i = 0; i < models.count; i++) {
                XCTAssertTrue([[models[i] class] isSubclassOfClass:[XXBook class]], @"Invalid class.");
                XXBook *book = (XXBook *)models[i];

                if ([book.title isEqualToString:bookTitle] &&
                    [book.author isEqualToString:bookAuthoer] &&
                     book.totalPages == bookTotalPages) {
                    foundBook1 = YES;
                }
                if ([book.title isEqualToString:anotherBookTitle] &&
                    [book.author isEqualToString:anotherBookAuthoer] &&
                     book.totalPages == anotherBookTotalPages) {
                    foundBook2 = YES;
                }
            }

            if (!foundBook1) {
                XCTFail(@"Book \"%@\" is not found correctly", bookTitle);
            }
            if (!foundBook2) {
                XCTFail(@"Book \"%@\" is not found correctly", anotherBookTitle);
            }

            ASYNC_TEST_SIGNAL

        } failure:ASYNC_TEST_FAILURE_BLOCK];

    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testUpdate {
    ASYNC_TEST_START
    [self.repository findById:createdId success:^(LBPersistedModel *model) {
        XXBook *book = (XXBook *)model;
        XCTAssertNotNil(book, @"No book found with ID %@", createdId);
        book.title = altBookTitle;
        book.totalPages = altBookTotalPages;
        book.hardcover = NO;

        [book saveWithSuccess:^() {

            [self.repository findById:createdId success:^(LBPersistedModel *model) {

                XXBook *book = (XXBook *)model;
                XCTAssertNotNil(book, @"No book found with ID %@", createdId);
                XCTAssertEqualObjects(book.title, altBookTitle, @"Invalid title");
                XCTAssertEqual(book.totalPages, altBookTotalPages, @"Invalid totalPages");
                XCTAssertEqual(book.hardcover, NO, @"Invalid hardcover property");
                ASYNC_TEST_SIGNAL

            } failure:ASYNC_TEST_FAILURE_BLOCK];

        } failure:ASYNC_TEST_FAILURE_BLOCK];

    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testRemove {
    ASYNC_TEST_START
    [self.repository findById:createdId success:^(LBPersistedModel *model) {

        [model destroyWithSuccess:^{

            [self.repository findById:createdId success:^(LBPersistedModel *model) {
                XCTFail(@"Model found after removal");
            } failure:^(NSError *err) {
                ASYNC_TEST_SIGNAL
            }];

        } failure:ASYNC_TEST_FAILURE_BLOCK];

    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

@end
