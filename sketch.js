let img;
let canvas;

function setup() {
    const canvas = createCanvas(600, 480);
    canvas.center('horizontal');
    background(220);

    const controlsDiv = createDiv('');
    controlsDiv.id('controls');
    controlsDiv.style('text-align', 'justify-between', 'center');
    controlsDiv.position(canvas.x, windowHeight - 220);

    // Black/White threshold slider set to an optimal position
    bwSlider = createSlider(0, 255, 128); // You might adjust this based on experimentation
    bwSlider.parent(controlsDiv);

    // Resolution slider for ellipse effect, set to an optimal position
    resSlider = createSlider(1, 20, 10); // Adjust as needed for artistic effect
    resSlider.parent(controlsDiv);

    // File input
    input = createFileInput(handleFile);
    input.parent(controlsDiv);

    // Download button
    button = createButton('Download');
    button.parent(controlsDiv);
    button.mousePressed(downloadImage);

    bwSlider.input(ellipseDitherImage);
    resSlider.input(ellipseDitherImage);

    noLoop(); // Stops draw() from continuously executing
}

function draw() {
    // Now only redraws when explicitly called
}

function handleFile(file) {
    if (file.type === 'image') {
        img = loadImage(file.data, () => {
            ellipseDitherImage(); // Changed to directly call the ellipse dithering function
        });
    }
}

function ellipseDitherImage() {
    clear(); // Clears the previous image
    background(220); // Reset background
    let resolution = resSlider.value();
    img.loadPixels();

    for (let y = 0; y < img.height; y += resolution) {
        for (let x = 0; x < img.width; x += resolution) {
            let gray = 0;
            let count = 0;

            // Calculate the average grayscale value of the block
            for (let ny = y; ny < y + resolution && ny < img.height; ny++) {
                for (let nx = x; nx < x + resolution && nx < img.width; nx++) {
                    let nindex = (nx + ny * img.width) * 4;
                    gray += (img.pixels[nindex] + img.pixels[nindex + 1] + img.pixels[nindex + 2]) / 3;
                    count++;
                }
            }
            gray /= count;

            // Determine the size of the ellipse based on gray value
            let size = map(gray, 0, 255, resolution, 0); // Inverse mapping so darker areas have bigger ellipses
            fill(gray); // Optionally, use black and white only
            noStroke();
            ellipse(x + resolution / 2, y + resolution / 2, size, size);
        }
    }
    redraw();
}

function downloadImage() {
    saveCanvas('dithered_image', 'png');
}



// Removed randomizeThreshold function since it's no longer needed
