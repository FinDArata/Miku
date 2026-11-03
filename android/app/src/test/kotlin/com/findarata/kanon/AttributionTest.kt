package com.findarata.kanon

import org.junit.Assert.assertEquals
import org.junit.Test

class AttributionTest {
    @Test fun nameAndRepoMatchPermission() {
        assertEquals("Kanon for Android", Attribution.APP_NAME)
        assertEquals("https://github.com/Louis-CFM/kanon", Attribution.REPO_URL)
    }
}
