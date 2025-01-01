import { Injectable, BadRequestException } from '@nestjs/common';
import { XMLParser } from "fast-xml-parser"


@Injectable()
export class JUnitParserService {
    private readonly xmlParser: XMLParser;

    constructor() {
        this.xmlParser = new XMLParser({ignoreAttributes: false});

    }

     /**
     * Extracts summary information from JUnit XML results.
     * @param xmlContent - The JUnit XML content as a string.
     * @returns A summary object containing total, passed, failed, and skipped test counts.
     */
     extractSummary(xmlContent: string): {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
    } {
        if (!xmlContent) {
            throw new BadRequestException('JUnit XML content is required');
        }

        try {
            // Parse the XML content
            const parsedData = this.xmlParser.parse(xmlContent);
            // Navigate to the testsuite attributes
            const testSuite = parsedData.testsuites;
            if (!testSuite || typeof testSuite !== 'object') {
                throw new BadRequestException('Invalid JUnit XML format');
            }

            const totalTests = parseInt(testSuite['@_tests'] || '0', 10);
            const failedTests = parseInt(testSuite['@_failures'] || '0', 10);
            const skippedTests = parseInt(testSuite['@_skipped'] || '0', 10);

            const passedTests = totalTests - failedTests - skippedTests;

            return {
                total: totalTests,
                passed: passedTests,
                failed: failedTests,
                skipped: skippedTests,
            };
        } catch (error) {
            throw new BadRequestException(`Error parsing JUnit XML: ${error.message}`);
        }
    }
}
