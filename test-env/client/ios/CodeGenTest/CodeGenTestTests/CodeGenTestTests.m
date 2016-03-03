//
//  CodeGenTestTests.m
//  CodeGenTestTests
//
//  Copyright (c) 2015 StrongLoop. All rights reserved.
//

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import "XXBook.h"
#import "XXBookRepository.h"


// The followings are utilities to run the asynchronous unit tests on Xcode 5 that doesn't have support
// for XCTestExpectation.  To be removed once CI is updated to use Xcode 6 or later.
#define ASYNC_TEST_START dispatch_semaphore_t sen_semaphore = dispatch_semaphore_create(0);
#define ASYNC_TEST_END \
while (dispatch_semaphore_wait(sen_semaphore, DISPATCH_TIME_NOW)) \
    [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:10]];
#define ASYNC_TEST_SIGNAL dispatch_semaphore_signal(sen_semaphore);
#define ASYNC_TEST_FAILURE_BLOCK \
^(NSError *error) { \
    XCTFail(@"Test failed: %@", error.description); \
    ASYNC_TEST_SIGNAL \
}


@interface CodeGenTestTests : XCTestCase

@property (nonatomic, strong) LBRESTAdapter *adapter;
@property (nonatomic, strong) XXBookRepository *repository;

@end

static NSString *bookTitle = @"The Hitchhiker's Guide to the Galaxy";
static NSString *bookAuthoer = @"Douglas Adams";
static NSNumber *bookTotalPages;
static NSArray *bookKeywords;

static NSString *altBookTitle = @"Mostly Harmless";
static NSNumber *altBookTotalPages;

static NSString *anotherBookTitle = @"A Farewell To Arms";
static NSString *anotherBookAuthoer = @"Ernest Hemingway";
static NSNumber *anotherBookTotalPages;

static NSNumber *createdId;


@implementation CodeGenTestTests

/**
 * Create the default test suite to control the order of test methods
 */
+ (id)defaultTestSuite {
    XCTestSuite *suite = [XCTestSuite testSuiteWithName:@"TestSuite for LBFile."];
    [suite addTest:[self testCaseWithSelector:@selector(testSave)]];
    [suite addTest:[self testCaseWithSelector:@selector(testExists)]];
    [suite addTest:[self testCaseWithSelector:@selector(testFindById)]];
    [suite addTest:[self testCaseWithSelector:@selector(testFindByIdFilter)]];
    [suite addTest:[self testCaseWithSelector:@selector(testAll)]];
    [suite addTest:[self testCaseWithSelector:@selector(testFindWithFilter)]];
    [suite addTest:[self testCaseWithSelector:@selector(testFindOne)]];
    [suite addTest:[self testCaseWithSelector:@selector(testFindOneWithFilter)]];
    [suite addTest:[self testCaseWithSelector:@selector(testUpdate)]];
    [suite addTest:[self testCaseWithSelector:@selector(testUpdateAllWithWhereFilterData)]];
    [suite addTest:[self testCaseWithSelector:@selector(testCount)]];
    [suite addTest:[self testCaseWithSelector:@selector(testCountWithWhereFilter)]];
    [suite addTest:[self testCaseWithSelector:@selector(testRemove)]];
    return suite;
}

- (void)setUp {
    [super setUp];

    self.adapter = [LBRESTAdapter adapterWithURL:[NSURL URLWithString:@"http://localhost:3010/api"]];
    self.repository = (XXBookRepository*)[self.adapter repositoryWithClass:[XXBookRepository class]];

    bookTotalPages = @224;
    altBookTotalPages = @240;
    anotherBookTotalPages = @352;
    bookKeywords = @[ @"novel", @"sci-fi", @"comedy" ];
}

- (void)tearDown {
    // Put teardown code here. This method is called after the invocation of each test method in the class.
    [super tearDown];
}

- (void)testSave {
    XXBook *book = [self.repository modelWithDictionary:nil];
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

- (void)testExists {
    ASYNC_TEST_START
    [self.repository existsWithId:createdId success:^(BOOL exists) {
        XCTAssertTrue(exists, @"No model found");
        ASYNC_TEST_SIGNAL
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testFindById {
    ASYNC_TEST_START
    [self.repository findById:createdId success:^(XXBook *book) {
        XCTAssertNotNil(book, @"No model found");
        XCTAssertEqualObjects(book.title, bookTitle, @"Invalid title");
        XCTAssertEqualObjects(book.author, bookAuthoer, @"Invalid author");
        XCTAssertEqualObjects(book.totalPages, bookTotalPages, @"Invalid totalPages");
        XCTAssertEqual(book.hardcover, YES, @"Invalid hardcover property");
        XCTAssertEqualObjects(book.keywords, bookKeywords, @"Invalid keywords");
        ASYNC_TEST_SIGNAL
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testFindByIdFilter {
    ASYNC_TEST_START
    [self.repository findById:createdId
                       filter: @{@"where": @{ @"title" : bookTitle }}
                      success:^(XXBook *book) {
        XCTAssertNotNil(book, @"No model found");
        XCTAssertEqualObjects(book.title, bookTitle, @"Invalid title");
        ASYNC_TEST_SIGNAL
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testAll {
    // add one more book for testing
    XXBook *anotherBook = [self.repository modelWithDictionary:nil];
    anotherBook.title = anotherBookTitle;
    anotherBook.author = anotherBookAuthoer;
    anotherBook.totalPages = anotherBookTotalPages;
    anotherBook.hardcover = YES;

    ASYNC_TEST_START
    [anotherBook saveWithSuccess:^{
        [self.repository allWithSuccess:^(NSArray *books) {
            BOOL foundBook1 = NO;
            BOOL foundBook2 = NO;
            XCTAssertNotNil(books, @"No models returned.");
            XCTAssertTrue([books count] >= 2, @"Invalid # of models returned: %lu", (unsigned long)[books count]);
            for (int i = 0; i < books.count; i++) {
                XCTAssertTrue([books[i] isMemberOfClass:[XXBook class]], @"Invalid class.");
                XXBook *book = books[i];
                if ([book.title isEqualToString:bookTitle] &&
                    [book.author isEqualToString:bookAuthoer] &&
                     book.totalPages.integerValue == bookTotalPages.integerValue) {
                    foundBook1 = YES;
                }
                if ([book.title isEqualToString:anotherBookTitle] &&
                    [book.author isEqualToString:anotherBookAuthoer] &&
                     book.totalPages.integerValue == anotherBookTotalPages.integerValue) {
                    foundBook2 = YES;
                }
            }
            XCTAssertTrue(foundBook1, @"Book \"%@\" is not found correctly", bookTitle);
            XCTAssertTrue(foundBook2, @"Book \"%@\" is not found correctly", anotherBookTitle);
            ASYNC_TEST_SIGNAL
        } failure:ASYNC_TEST_FAILURE_BLOCK];
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testFindWithFilter {
    ASYNC_TEST_START
    [self.repository findWithFilter:@{@"where": @{ @"title": bookTitle }}
                            success:^(NSArray *books) {
        XCTAssertNotNil(books, @"No models returned.");
        XCTAssertTrue([books count] >= 1, @"Invalid # of models returned: %lu", (unsigned long)[books count]);
        for (int i = 0; i < books.count; i++) {
            XCTAssertTrue([books[i] isMemberOfClass:[XXBook class]], @"Invalid class.");
            XXBook *book = books[i];
            XCTAssertEqualObjects(book.title, bookTitle, @"Invalid title");
        }
        ASYNC_TEST_SIGNAL
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testFindOne {
    ASYNC_TEST_START
    [self.repository findOneWithSuccess:^(XXBook *book) {
        // there should be at least one book
        XCTAssertNotNil(book, @"No model found");
        ASYNC_TEST_SIGNAL
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testFindOneWithFilter {
    ASYNC_TEST_START
    [self.repository findOneWithFilter:@{@"where": @{ @"title": bookTitle }} success:^(XXBook *book) {
        XCTAssertNotNil(book, @"No model found");
        XCTAssertEqualObjects(book.title, bookTitle, @"Invalid title");
        ASYNC_TEST_SIGNAL
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testUpdate {
    ASYNC_TEST_START
    [self.repository findById:createdId success:^(XXBook *book) {
        XCTAssertNotNil(book, @"No book found with ID %@", createdId);
        book.title = altBookTitle;
        book.totalPages = altBookTotalPages;
        book.hardcover = NO;

        [book saveWithSuccess:^() {
            [self.repository findById:createdId success:^(XXBook *bookAlt) {
                XCTAssertNotNil(bookAlt, @"No book found with ID %@", createdId);
                XCTAssertEqualObjects(bookAlt.title, altBookTitle, @"Invalid title");
                XCTAssertEqualObjects(bookAlt.author, bookAuthoer, @"Invalid author");
                XCTAssertEqualObjects(bookAlt.totalPages, altBookTotalPages, @"Invalid totalPages");
                XCTAssertEqual(bookAlt.hardcover, NO, @"Invalid hardcover property");
                XCTAssertEqualObjects(bookAlt.keywords, bookKeywords, @"Invalid keywords");
                ASYNC_TEST_SIGNAL
            } failure:ASYNC_TEST_FAILURE_BLOCK];
        } failure:ASYNC_TEST_FAILURE_BLOCK];
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testUpdateAllWithWhereFilterData {
    // Revert the change done in testUpdate
    XXBook *bookOrig = [self.repository modelWithDictionary:nil];
    bookOrig.title = bookTitle;
    bookOrig.author = bookAuthoer;
    bookOrig.totalPages = bookTotalPages;
    bookOrig.hardcover = YES;
    bookOrig.keywords = bookKeywords;

    ASYNC_TEST_START
    [self.repository updateAllWithWhereFilter:@{ @"title": altBookTitle }
                                         data:bookOrig
                                      success:^(NSDictionary *dictionary) {
        XCTAssertTrue(dictionary.count > 0, @"No model updated");
        [self.repository findById:createdId success:^(XXBook *book) {
            XCTAssertNotNil(book, @"No model found");
            XCTAssertEqualObjects(book.title, bookTitle, @"Invalid title");
            XCTAssertEqualObjects(book.author, bookAuthoer, @"Invalid author");
            XCTAssertEqualObjects(book.totalPages, bookTotalPages, @"Invalid totalPages");
            XCTAssertEqual(book.hardcover, YES, @"Invalid hardcover property");
            XCTAssertEqualObjects(book.keywords, bookKeywords, @"Invalid keywords");
            ASYNC_TEST_SIGNAL
        } failure:ASYNC_TEST_FAILURE_BLOCK];
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testCount {
    ASYNC_TEST_START
    [self.repository countWithSuccess:^(NSNumber *count) {
        NSInteger prevCount = count.integerValue;

        // add one more book for testing
        XXBook *anotherBook = [self.repository modelWithDictionary:nil];
        anotherBook.title = anotherBookTitle;
        anotherBook.author = anotherBookAuthoer;
        anotherBook.totalPages = anotherBookTotalPages;
        anotherBook.hardcover = YES;

        [anotherBook saveWithSuccess:^{
            [self.repository countWithSuccess:^(NSNumber *count) {
                XCTAssertTrue(count.integerValue == prevCount + 1, @"Invalid # of models returned: %@", count);
                ASYNC_TEST_SIGNAL
            } failure:ASYNC_TEST_FAILURE_BLOCK];
        } failure:ASYNC_TEST_FAILURE_BLOCK];
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testCountWithWhereFilter {
    ASYNC_TEST_START
    [self.repository countWithWhereFilter:@{ @"title": anotherBookTitle }
                                  success:^(NSNumber *count) {
        NSInteger prevCount = count.integerValue;

        // add one more book for testing
        XXBook *anotherBook = [self.repository modelWithDictionary:nil];
        anotherBook.title = anotherBookTitle;
        anotherBook.author = anotherBookAuthoer;
        anotherBook.totalPages = anotherBookTotalPages;
        anotherBook.hardcover = YES;

        [anotherBook saveWithSuccess:^{
            [self.repository countWithWhereFilter:@{ @"title": anotherBookTitle }
                                          success:^(NSNumber *count) {
                XCTAssertTrue(count.integerValue == prevCount + 1, @"Invalid # of models returned: %@", count);
                ASYNC_TEST_SIGNAL
            } failure:ASYNC_TEST_FAILURE_BLOCK];
        } failure:ASYNC_TEST_FAILURE_BLOCK];
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

- (void)testRemove {
    ASYNC_TEST_START
    [self.repository findById:createdId success:^(XXBook *book) {
        [book destroyWithSuccess:^{
            [self.repository findById:createdId success:^(XXBook *book) {
                XCTFail(@"Model found after removal");
            } failure:^(NSError *err) {
                ASYNC_TEST_SIGNAL
            }];
        } failure:ASYNC_TEST_FAILURE_BLOCK];
    } failure:ASYNC_TEST_FAILURE_BLOCK];
    ASYNC_TEST_END
}

@end
