<?php
// Profile picture upload and download
$uploadDir = __DIR__ . '/uploads/';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['avatar'])) {
    $name = $_FILES['avatar']['name'];
    move_uploaded_file($_FILES['avatar']['tmp_name'], $uploadDir . $name);
    echo "Uploaded " . $name;
}

if (isset($_GET['file'])) {
    $path = $uploadDir . $_GET['file'];
    readfile($path);
}
?>
