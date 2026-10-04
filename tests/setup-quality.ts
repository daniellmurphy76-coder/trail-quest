/**
 * Pin the quality tier for every test file. getQuality() otherwise reads the machine it runs on
 * (CPU cores, memory), so a small CI runner would detect "medium" and grow fewer plants than the
 * tests expect. Tests that exercise detection call detectQuality() or setQuality() directly.
 */
import { setQuality } from '../src/engine/quality';

setQuality('high');
